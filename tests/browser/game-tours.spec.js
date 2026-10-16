const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");

test.use({ serviceWorkers: "block" });

const GAME_ID = "game-tour-fixture";
const TOUR = "[data-game-tour]";
const SETTING = "[data-game-tour-settings]";

function snapshot(overrides = {}) {
  return {
    _name: "Einsteigertour", _mode: "2", _hardcore: false,
    _players: [{ id: "p1", name: "Anna", user_id: 42 }, { id: "p2", name: "Ben", user_id: 43 }],
    _players_joined: 2, _expected: 2, _started: true, _finished: false, _aborted: false,
    _paused: false, _offline_players: [], _connected: { p1: true, p2: true },
    _turn: { player_id: "p1", roll_index: 1 }, _dice: [5, 5, 2, 3, 4],
    _holds: [false, false, false, false, false], _rolls_used: 1, _rolls_max: 3,
    _scoreboards: { p1: {}, p2: {} }, _admin_edits: {}, _superadmin_active: false,
    _announced_row4: null, _announced_by: null, _announced_board: null,
    _correction: { active: false }, _teams: [], _scoreboards_by_team: {},
    _results: null, _last_write_public: {}, _has_last: {}, _auto_single: false,
    _chat_history: [], suggestions: [], ...overrides,
  };
}

// Match the authoritative fields used by the existing Zilch scorepad and roll
// fixtures, keeping the game renderer rather than reproducing it in the test.
function zilchSnapshot({ rolled = true, actor = "p1" } = {}) {
  const players = [{ id: "p1", name: "Anna", user_id: 42, connected: true, type: "human" },
    { id: "p2", name: "Ben", user_id: 43, connected: true, type: "human" }];
  return {
    _game_type: "zilch", _name: "Zilch tour", _players: players, _participants: players,
    _play_mode: "multiplayer", _mode: "2", _players_joined: 2, _expected: 2,
    _started: true, _finished: false, _aborted: false, _paused: false, _offline_players: [],
    _target_score: 10000, _zilch_ruleset: "zilch-house-v1", _chat_history: [], _gameplay_status: "playable",
    _zilch_start_roll: { phase: "resolved", player_ids: ["p1", "p2"], pending_player_ids: [],
      rolls: { p1: 6, p2: 3 }, winner_id: "p1", version: 2 },
    _zilch_final_round: null, _turn: { player_id: actor },
    _dice: rolled ? [1, 1, 1, 5, 2, 6] : Array(6).fill(0), _holds: Array(6).fill(false), _rolls_used: rolled ? 1 : 0,
    _zilch_boards: Object.fromEntries(players.map(player => [player.id, {
      player_id: player.id, active: player.id === actor, connected: true, total_points: 0,
      round_points: 0, zilch_streak: 0, rounds: [],
    }])),
    _round_points: { p1: 0, p2: 0 }, _total_points: { p1: 0, p2: 0 },
    _zilch_turn_state: {
      turn_id: 11, version: 1, phase: rolled ? "awaiting_hold" : "ready_to_roll", roll_id: rolled ? 1 : 0,
      rolls_used: rolled ? 1 : 0, available_dice_indices: [0, 1, 2, 3, 4, 5], held_dice_indices: [],
      committed_holds: [], round_points: 0, confirmation_required: false, confirmation_reasons: [],
      can_roll: !rolled, can_select_hold: rolled, can_bank: false, bank_block_reason: "zilch_hold_required",
    },
    _zilch_quick_holds: rolled ? [{ id: "three-ones", combination_type: "three_ones", dice_indices: [0, 1, 2],
      dice_values: [1, 1, 1], points: 1000, label_key: "zilch.option.three_ones", label_params: {}, roll_id: 1,
      requires_confirmation: true, hot_dice: false, free_roll: false, all_available_dice: false,
      follow_up_actions: ["zilch_roll_dice"] }] : [],
  };
}

function hausdeppSnapshot() {
  const players = [{ id: "p1", name: "Anna", user_id: 42, is_cpu: false, hand_count: 3, finished: false },
    { id: "p2", name: "Ben", user_id: 43, is_cpu: false, hand_count: 3, finished: false }];
  return {
    _game_type: "hausdepp", _name: "Hausdepp tour", _mode: "2", _players: players, _participants: players,
    _players_joined: 2, _expected: 2, _started: true, _finished: false, _aborted: false, _paused: false,
    _turn: { player_id: "p1" }, _chat_history: [],
    _hausdepp: {
      viewer_id: "p1", version: 1, phase: "playing", current_player_id: "p1", dealer_id: "p2", players,
      hand: ["hearts-7", "hearts-9", "bells-K"], discard: ["hearts-6"], deck_count: 24, burned_count: 0,
      available_actions: ["play", "gamble", "pickup"], playable_cards: ["hearts-7", "hearts-9", "bells-K"],
      pending_refill: null, pending_refills: [], afterthrow: null, finished_order: [], loser_id: null,
      draw_required: false, draw_urgent: false, stock_blocked_by: null, deal: null,
      peek: { player_id: "p1", success: false, complete: true }, private_peek: [],
      last_event: { type: "round_started" },
    },
  };
}

/** The real room renders a small authoritative snapshot; only identity, tour
 * persistence and its game socket are mocked. No game/account is created. */
async function harness(page, { language = "de", authenticated = true, enabled = true,
  games = {}, spectator = false, game = "zdwa", initial = snapshot() } = {}) {
  const user = { id: 42, username: "Anna", is_admin: false, role: "user", csrf_token: "tour-fixture-csrf",
    must_change_password: false, preferences: { preferred_language: language, auto_write_announced: false },
    design: { zdwa_2026_available: true, zdwa: "new", prompt_pending: false } };
  const auth = { authenticated, user: authenticated ? user : null,
    game_access: { zilch_public: true, zilch_preview: true, hausdepp_public: true },
    passkeys: { enabled: false }, registration: { email_enabled: false, turnstile_enabled: false } };
  const server = { data: { enabled, games: { zdwa: "unseen", zilch: "unseen", hausdepp: "unseen", ...games } },
    claims: [], writes: [], requests: [] };
  await page.addInitScript(lang => localStorage.setItem("zdwa_language", lang), language);
  await page.route("**/api/auth/me", route => route.fulfill({ json: auth }));
  await page.route("**/api/releases**", route => route.fulfill({
    json: { viewer_id: authenticated ? 42 : null, current_version: "3.1.0", releases: [], can_prompt: false },
  }));
  await page.route("**/api/auth/tours", async route => {
    server.requests.push(route.request().method());
    if (!auth.authenticated) return route.fulfill({ status: 401, json: { detail: "authentication_required" } });
    if (route.request().method() === "PUT") {
      const data = route.request().postDataJSON();
      server.writes.push(data);
      server.data = { enabled: data.enabled ?? server.data.enabled,
        games: { ...server.data.games, ...(data.game_type ? { [data.game_type]: data.state } : {}) } };
    }
    await route.fulfill({ json: server.data });
  });
  await page.route("**/api/auth/tours/offer", async route => {
    const { game_type: game } = route.request().postDataJSON();
    server.claims.push(game);
    const show = server.data.enabled && server.data.games[game] === "unseen";
    if (show) server.data.games[game] = "dismissed";
    await route.fulfill({ json: { show, ...server.data } });
  });
  const actions = [];
  const sockets = [];
  const state = structuredClone(initial);
  const gamePath = ["zilch", "hausdepp"].includes(game) ? `/${game}/spiel/${GAME_ID}${spectator ? "/zuschauen" : ""}`
    : `/spiel/${GAME_ID}?name=Anna${spectator ? "&spectator=1" : ""}`;
  if (["zilch", "hausdepp"].includes(game)) {
    await page.route(`**/api/games/${GAME_ID}*`, route => route.fulfill({ json: {
      exists: true, game_type: game, name: state._name, mode: "2", play_mode: "multiplayer", locked: false,
      participants: state._participants, player_statuses: state._players,
    } }));
    await page.route(`**${gamePath}`, async route => route.fulfill({
      contentType: "text/html", body: await readFile(`app/static/${game}.html`),
    }));
  }
  let socket;
  await page.routeWebSocket(new RegExp(`/ws/${GAME_ID}$`), connection => {
    socket = connection;
    sockets.push(connection);
    connection.onMessage(raw => {
      const action = JSON.parse(String(raw));
      actions.push(action);
      if (["join_game", "rejoin_game", "spectate_game"].includes(action.action)) {
        connection.send(JSON.stringify(spectator ? { spectator_id: "s1", auth } : {
          player_id: "p1", resume_token: "tour-fixture-resume", auth,
        }));
        connection.send(JSON.stringify({ scoreboard: state }));
      }
    });
  });
  return {
    server, state, actions, sockets,
    async open() {
      await page.goto(gamePath);
      if (game === "zilch") await expect(page.locator(".zilch-play-layout")).toBeVisible();
      else if (game === "hausdepp") {
        await expect(page.locator("#hausdeppConnection")).toContainText(/Verbunden|Connected/);
        await expect(page.locator("#hausdeppHand [data-card-id]")).toHaveCount(state._hausdepp.hand.length);
      }
      else await expect(page.locator("#diceBar .die")).toHaveCount(5);
    },
    push() { socket.send(JSON.stringify({ scoreboard: state })); },
    disconnect() { socket.close({ code: 1012, reason: "tour reconnect fixture" }); },
    signIn() { auth.authenticated = true; auth.user = user; },
    signOut() { auth.authenticated = false; auth.user = null; },
  };
}

function gameActions(room) {
  return room.actions.filter(action => !["join_game", "rejoin_game", "spectate_game", "ping", "heartbeat"].includes(action.action));
}

async function startOfferedTour(page) {
  await expect(page.locator(`${TOUR}[data-tour-mode="offer"]`)).toBeVisible();
  await page.locator("[data-tour-start]").click();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "active");
  await expect(page.locator("[data-tour-end]")).toBeVisible();
}

async function openSettings(page) {
  await page.goto("/konto#settings");
  const help = page.locator('details[data-account-section="help"]');
  if (await help.getAttribute("open") === null) await help.locator(":scope > summary").click();
  await expect(page.locator(SETTING)).toBeVisible();
}

test("ZDWA offers a tour once and starts only after consent; dismiss survives reload", async ({ page }) => {
  const room = await harness(page);
  await room.open();
  await expect(page.locator(`${TOUR}[data-tour-mode="offer"]`)).toBeVisible();
  await expect(page.locator("[data-tour-next]")).toHaveCount(0);
  expect(room.server.claims).toEqual(["zdwa"]);
  expect(gameActions(room)).toEqual([]);
  await page.locator("[data-tour-dismiss]").click();
  await expect(page.locator(TOUR)).toBeHidden();
  await page.reload();
  await expect(page.locator("#diceBar .die")).toHaveCount(5);
  await expect.poll(() => room.server.requests.length).toBeGreaterThanOrEqual(2);
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.data.games.zdwa).toBe("dismissed");
  expect(gameActions(room)).toEqual([]);
});

test("a lobby visit or waiting for the other player does not consume the first-game offer", async ({ page }) => {
  const room = await harness(page, { initial: snapshot({ _started: false, _players_joined: 1,
    _turn: { player_id: null, roll_index: 0 }, _rolls_used: 0 }) });
  await page.goto("/");
  await expect(page.locator("#authBadge")).toContainText("Anna");
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.claims).toEqual([]);
  await room.open();
  await expect(page.locator("#rollBtnInline")).toBeDisabled();
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.claims).toEqual([]);
  room.state._started = true;
  room.state._players_joined = 2;
  room.state._turn = { player_id: "p1", roll_index: 1 };
  room.state._rolls_used = 1;
  room.push();
  await expect(page.locator(`${TOUR}[data-tour-mode="offer"]`)).toBeVisible();
  expect(room.server.claims).toEqual(["zdwa"]);
});

for (const exit of ["end", "close", "escape"]) {
  test(`ZDWA ${exit} ends the active tour immediately without a game action or reopening`, async ({ page }, testInfo) => {
    const room = await harness(page);
    await room.open();
    await startOfferedTour(page);
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "welcome");
    await page.locator("[data-tour-next]").click();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "hold");
    if (exit === "end") await page.screenshot({ path: testInfo.outputPath("zdwa-tour-desktop.png"), animations: "disabled" });
    await page.locator("[data-tour-back]").click();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "welcome");
    if (exit === "escape") await page.keyboard.press("Escape");
    else await page.locator(exit === "close" ? "[data-tour-close]" : "[data-tour-end]").click();
    await expect(page.locator(TOUR)).toBeHidden();
    expect(gameActions(room)).toEqual([]);
    await expect(page.locator("#rollBtnInline")).toBeEnabled();
    await page.reload();
    await expect(page.locator("#diceBar .die")).toHaveCount(5);
    await expect.poll(() => room.server.requests.length).toBeGreaterThanOrEqual(2);
    await expect(page.locator(TOUR)).toBeHidden();
  });
}

test("ZDWA first offers the guide on the player's turn, never to a spectator", async ({ page, context }) => {
  const room = await harness(page, { initial: snapshot({ _turn: { player_id: "p2", roll_index: 1 } }) });
  await room.open();
  await expect(page.locator("#rollBtnInline")).toBeDisabled();
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.claims).toEqual([]);
  room.state._turn.player_id = "p1";
  room.push();
  await expect(page.locator(`${TOUR}[data-tour-mode="offer"]`)).toBeVisible();
  const watcher = await context.newPage();
  const spectator = await harness(watcher, { spectator: true });
  await spectator.open();
  await expect(watcher.locator("#rollBtnInline")).toBeDisabled();
  await expect(watcher.locator(TOUR)).toBeHidden();
  expect(spectator.server.claims).toEqual([]);
  expect(gameActions(spectator)).toEqual([]);
  await watcher.close();
});

test("ZDWA pauses contextual guidance for opponent turns and game pauses, and retains an immediate exit", async ({ page }) => {
  const room = await harness(page);
  await room.open();
  await startOfferedTour(page);
  await page.locator("[data-tour-next]").click();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "hold");
  for (const unavailable of ["opponent", "pause"]) {
    if (unavailable === "opponent") room.state._turn.player_id = "p2";
    else room.state._paused = true;
    room.push();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
    await expect(page.locator("[data-tour-end]")).toBeVisible();
    await expect(page.locator("[data-tour-next]:enabled")).toHaveCount(0);
    room.state._turn.player_id = "p1";
    room.state._paused = false;
    room.push();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "active");
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "hold");
  }
  room.state._paused = true;
  room.push();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
  await page.locator("[data-tour-end]").click();
  await expect(page.locator(TOUR)).toBeHidden();
  expect(gameActions(room)).toEqual([]);
});

test("ZDWA reconnect resumes guidance without claiming or starting it again", async ({ page }) => {
  const room = await harness(page);
  await room.open();
  await startOfferedTour(page);
  await page.locator("[data-tour-next]").click();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "hold");
  room.disconnect();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
  await expect(page.locator("[data-tour-end]")).toBeVisible();
  await expect.poll(() => room.sockets.length).toBe(2);
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "active");
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "hold");
  expect(room.server.claims).toEqual(["zdwa"]);
  expect(gameActions(room)).toEqual([]);
});

test("ZDWA Hardcore skips hold, reroll and announcement steps", async ({ page }) => {
  const room = await harness(page, { initial: snapshot({ _hardcore: true, _rolls_max: 1 }) });
  await room.open();
  await startOfferedTour(page);
  const visited = [];
  for (let index = 0; index < 7; index += 1) {
    const step = await page.locator(TOUR).getAttribute("data-tour-step");
    visited.push(step);
    expect(["hold", "roll", "announce"]).not.toContain(step);
    if (step === "finish") break;
    await page.locator("[data-tour-next]").click();
  }
  expect(visited).toContain("write");
  expect(visited.at(-1)).toBe("finish");
  await page.locator("[data-tour-end]").click();
  await expect(page.locator(TOUR)).toBeHidden();
  expect(gameActions(room)).toEqual([]);
});

for (const language of ["de", "en"]) {
  test(`ZDWA ${language} tour stays readable and dismissible at 320px with reduced motion`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const room = await harness(page, { language });
    await room.open();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.locator("[data-tour-start]")).toHaveText(language === "de" ? "Tour starten" : "Start tour");
    await startOfferedTour(page);
    await expect(page.locator("[data-tour-end]")).toHaveText(language === "de" ? "Tour beenden" : "End tour");
    await page.locator("[data-tour-next]").click();
    const geometry = await page.locator(TOUR).evaluate(node => {
      const rect = node.getBoundingClientRect();
      const end = node.querySelector("[data-tour-end]").getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        endBottom: end.bottom, width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1);
    expect(geometry.endBottom).toBeLessThanOrEqual(geometry.height + 1);
    expect(geometry.overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`zdwa-tour-mobile-${language}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(page.locator(TOUR)).toBeHidden();
    expect(gameActions(room)).toEqual([]);
  });
}

test("ZDWA 320px writing guidance leaves the highlighted real score cell and Tour end reachable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const room = await harness(page);
  await room.open();
  await startOfferedTour(page);
  for (const step of ["hold", "roll", "write"]) {
    await page.locator("[data-tour-next]").click();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", step);
  }
  const cell = page.locator(".player-card.me td.cell.clickable.game-tour-target");
  await expect(cell).toHaveCount(1);
  await cell.click({ trial: true });
  await page.locator("[data-tour-end]").click({ trial: true });
  await page.screenshot({ path: testInfo.outputPath("zdwa-tour-mobile-write.png"), animations: "disabled" });
  expect(gameActions(room)).toEqual([]);
  await page.locator("[data-tour-end]").click();
  await expect(page.locator(TOUR)).toBeHidden();
  expect(gameActions(room)).toEqual([]);
});

test("settings can disable automatic offers, view examples and request a tour without creating a game", async ({ page }) => {
  const room = await harness(page);
  const mutations = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    // Opening the settings may record a normal page-view engagement event.
    // These assertions concern creation of games, results and player stats.
    if (!/^(GET|HEAD|OPTIONS)$/.test(request.method())
      && /^\/api\/(?:games(?:\/|$)|offline(?:\/|$)|.*(?:results|statistics))/.test(path)) {
      mutations.push({ method: request.method(), url: path });
    }
  });
  await openSettings(page);
  await page.locator("[data-tour-enabled]").uncheck();
  await expect.poll(() => room.server.data.enabled).toBe(false);
  await page.locator("[data-tour-action='view'][data-tour-game='zdwa']").click();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "view");
  await expect(page.locator("[data-tour-end]")).toBeVisible();
  await page.locator("[data-tour-next]").click();
  await page.locator("[data-tour-back]").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.actions).toEqual([]);
  expect(mutations).toEqual([]);
  expect(room.server.data.games).toEqual({ zdwa: "unseen", zilch: "unseen", hausdepp: "unseen" });
  expect(room.server.writes.filter(patch => patch.game_type)).toEqual([]);
  await page.reload();
  const help = page.locator('details[data-account-section="help"]');
  if (await help.getAttribute("open") === null) await help.locator(":scope > summary").click();
  await expect(page.locator("[data-tour-enabled]")).not.toBeChecked();
  await page.locator("[data-tour-action='start'][data-tour-game='zdwa']").click();
  await expect(page.locator("[data-tour-cancel-entry]")).toBeVisible();
  expect(mutations).toEqual([]);
  expect(room.actions).toEqual([]);
  // A manual request still works after automatic first-game offers are off.
  await room.open();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "active");
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "welcome");
  expect(room.server.claims).toEqual([]);
  expect(gameActions(room)).toEqual([]);
  expect(mutations).toEqual([]);
});

async function delayedTourSettings(page, game, language = "de") {
  const room = await harness(page, { language, enabled: false });
  let release, pending = false, released = false;
  const barrier = new Promise(resolve => { release = () => { released = true; resolve(); }; });
  await page.route("**/api/auth/tours", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    pending = true;
    await barrier;
    await route.fulfill({ json: room.server.data });
  });
  if (game === "hausdepp") {
    // A labelled account renderer: no session, account or tour data is written.
    await page.route("**/hausdepp/konto/einstellungen", async route => route.fulfill({
      contentType: "text/html", body: await readFile("app/static/hausdepp-settings.html"),
    }));
  }
  return {
    room, release, get released() { return released; },
    async open() {
      if (game === "hausdepp") {
        await page.goto("/hausdepp/konto/einstellungen");
        await expect(page.locator(SETTING)).toBeVisible();
      } else await openSettings(page);
      await expect.poll(() => pending).toBe(true);
    },
  };
}

for (const game of ["hausdepp", "zdwa"]) for (const language of ["de", "en"]) {
  test(`${game} ${language}: visible tour previews and start work before the initial preferences response`, async ({ page }) => {
    const delayed = await delayedTourSettings(page, game, language);
    try {
      await delayed.open();
      const settings = page.locator(SETTING);
      await expect(settings.locator("[data-tour-enabled]")).toBeDisabled();
      for (const preview of ["hausdepp", "zilch", "zdwa"]) {
        await settings.locator(`[data-tour-action=view][data-tour-game=${preview}]`).click();
        await expect(page.locator(TOUR)).toHaveAttribute("data-game-tour", preview);
        await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "view");
        await page.locator("[data-tour-close]").click();
      }
      expect(delayed.room.server.writes).toEqual([]);
      await settings.locator(`[data-tour-action=start][data-tour-game=${game}]`).click();
      await expect(page.locator(".game-tour-entry")).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(game === "hausdepp" ? "/hausdepp" : "/");
      expect(delayed.released, "Navigation works while the account read is still blocked").toBe(false);
      expect(delayed.room.server.writes).toEqual([]);
      expect(delayed.room.actions).toEqual([]);
    } finally {
      delayed.release();
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });
}

for (const game of ["hausdepp", "zdwa"]) {
  test(`${game}: delayed tour preferences keep the toggle disabled, then bind the first real change`, async ({ page }) => {
    const delayed = await delayedTourSettings(page, game);
    try {
      await delayed.open();
      const toggle = page.locator(`${SETTING} [data-tour-enabled]`);
      await expect(toggle).toBeDisabled();
      expect(delayed.room.server.writes).toEqual([]);
      delayed.release();
      await expect(toggle).toBeEnabled();
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await expect.poll(() => delayed.room.server.writes).toEqual([{ enabled: true }]);
      expect(delayed.room.actions).toEqual([]);
    } finally {
      delayed.release();
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });
}

test("disabling offers keeps the first own game quiet", async ({ page }) => {
  const room = await harness(page, { enabled: false });
  await room.open();
  await expect.poll(() => room.server.requests.length).toBeGreaterThan(0);
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.claims).toEqual([]);
  expect(gameActions(room)).toEqual([]);
});

test("guest tour dismissal is remembered in this browser without account writes", async ({ page }) => {
  const room = await harness(page, { authenticated: false });
  await room.open();
  await expect(page.locator(`${TOUR}[data-tour-mode="offer"]`)).toBeVisible();
  await page.locator("[data-tour-dismiss]").click();
  await expect(page.locator(TOUR)).toBeHidden();
  await page.reload();
  await expect(page.locator("#diceBar .die")).toHaveCount(5);
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.writes).toEqual([]);
  expect(room.server.claims).toEqual([]);
  expect(gameActions(room)).toEqual([]);
});

test("signing in keeps an explicit guest dismissal instead of immediately prompting again", async ({ page }) => {
  const room = await harness(page, { authenticated: false });
  await room.open();
  await expect(page.locator(`${TOUR}[data-tour-mode="offer"]`)).toBeVisible();
  await page.locator("[data-tour-dismiss]").click();
  await expect(page.locator(TOUR)).toBeHidden();
  room.signIn();
  await page.reload();
  await expect(page.locator("#diceBar .die")).toHaveCount(5);
  await expect.poll(() => room.server.data.games.zdwa).toBe("dismissed");
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.claims).toEqual([]);
  expect(gameActions(room)).toEqual([]);
});

test("guest opt-out imports once and later respects an account's explicit re-enabling", async ({ page }) => {
  const room = await harness(page, { authenticated: false });
  await page.goto("/");
  const guest = page.locator("[data-guest-tour-settings]");
  await expect(guest).toBeVisible();
  await guest.locator(":scope > summary").click();
  await page.locator("[data-tour-enabled]").uncheck();
  room.signIn();
  await openSettings(page);
  await expect.poll(() => room.server.data.enabled).toBe(false);
  await expect(page.locator("[data-tour-enabled]")).not.toBeChecked();
  await page.locator("[data-tour-enabled]").check();
  await expect.poll(() => room.server.data.enabled).toBe(true);
  room.signOut();
  await page.goto("/");
  await expect(page.locator("[data-guest-tour-settings]")).toBeVisible();
  room.signIn();
  await openSettings(page);
  await expect(page.locator("[data-tour-enabled]")).toBeChecked();
  expect(room.server.data.enabled).toBe(true);
});

test("queued tour saves from account A cannot overwrite account B after logout and sign-in", async ({ page }) => {
  await harness(page);
  let account = 42;
  const identity = () => ({ authenticated: account !== null, user: account === null ? null : {
    id: account, username: account === 42 ? "Anna" : "Bea", csrf_token: `tour-csrf-${account}`,
    role: "user", preferences: { preferred_language: "de" },
  }, passkeys: { enabled: false }, game_access: { zilch_public: true, hausdepp_public: true } });
  const preferences = {
    42: { enabled: true, games: { zdwa: "dismissed", zilch: "unseen", hausdepp: "unseen" } },
    84: { enabled: false, games: { zdwa: "unseen", zilch: "unseen", hausdepp: "unseen" } },
  };
  const writes = [];
  let releaseFirstWrite;
  const firstWrite = new Promise(resolve => { releaseFirstWrite = resolve; });
  await page.route("**/api/auth/me", route => route.fulfill({ json: identity() }));
  await page.route("**/api/auth/logout", async route => {
    account = null;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/auth/login", async route => {
    account = 84;
    await route.fulfill({ json: identity() });
  });
  await page.route("**/api/auth/tours", async route => {
    const owner = account;
    if (owner === null) return route.fulfill({ status: 401, json: {} });
    if (route.request().method() === "PUT") {
      const patch = route.request().postDataJSON();
      writes.push({ owner, patch });
      if (writes.length === 1) await firstWrite;
      if (typeof patch.enabled === "boolean") preferences[owner].enabled = patch.enabled;
      if (patch.game_type) preferences[owner].games[patch.game_type] = patch.state;
    }
    await route.fulfill({ json: preferences[owner] });
  });
  await openSettings(page);
  await page.locator("[data-tour-enabled]").uncheck();
  await expect.poll(() => writes.length).toBe(1);
  await page.locator("[data-tour-enabled]").check();
  await page.evaluate(async () => {
    const auth = await import("/static/auth.js");
    await auth.logout();
    await auth.login("Bea", "fixture-password");
  });
  const saved = page.waitForResponse(response => response.url().endsWith("/api/auth/tours")
    && response.request().method() === "PUT");
  releaseFirstWrite();
  await saved;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(writes.filter(write => write.owner === 84)).toEqual([]);
  expect(preferences[84]).toEqual({ enabled: false, games: { zdwa: "unseen", zilch: "unseen", hausdepp: "unseen" } });
});

test("Zilch has its own voluntary first-game offer even after completing ZDWA", async ({ page }) => {
  const room = await harness(page, { game: "zilch", initial: zilchSnapshot(), games: { zdwa: "completed" } });
  await room.open();
  await expect(page.locator(`${TOUR}[data-tour-mode="offer"]`)).toBeVisible();
  expect(room.server.claims).toEqual(["zilch"]);
  expect(gameActions(room)).toEqual([]);
  await page.locator("[data-tour-dismiss]").click();
  await expect(page.locator(TOUR)).toBeHidden();
  await page.reload();
  await expect(page.locator(".zilch-play-layout")).toBeVisible();
  await expect.poll(() => room.server.requests.length).toBeGreaterThanOrEqual(2);
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.data.games.zdwa).toBe("completed");
  expect(room.server.data.games.zilch).toBe("dismissed");
});

test("Zilch explains selection, risk and banking without making those choices for the player", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const room = await harness(page, { game: "zilch", initial: zilchSnapshot({ rolled: false }) });
  await room.open();
  await startOfferedTour(page);
  await page.locator("[data-tour-next]").click();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "roll");
  await page.locator("[data-tour-next]").click();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "select");
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
  await expect(page.locator("[data-tour-next]")).toBeDisabled();
  expect(gameActions(room)).toEqual([]);
  Object.assign(room.state, zilchSnapshot());
  room.push();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "active");
  await expect(page.locator("[data-tour-next]")).toBeEnabled();
  for (const step of ["risk", "bank", "finish"]) {
    await page.locator("[data-tour-next]").click();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", step);
  }
  await page.locator("[data-tour-next]").click();
  await expect(page.locator(TOUR)).toBeHidden();
  await expect.poll(() => room.server.data.games.zilch).toBe("completed");
  expect(gameActions(room)).toEqual([]);
});

test("Zilch keeps the end control during opponent turns, pauses and a reconnect", async ({ page }) => {
  const room = await harness(page, { game: "zilch", initial: zilchSnapshot() });
  await room.open();
  await startOfferedTour(page);
  for (const step of ["roll", "select"]) {
    await page.locator("[data-tour-next]").click();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", step);
  }
  room.state._turn.player_id = "p2";
  room.push();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
  await expect(page.locator("[data-tour-end]")).toBeVisible();
  await expect(page.locator("[data-tour-next]")).toBeDisabled();
  room.state._turn.player_id = "p1";
  room.state._paused = true;
  room.push();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
  room.state._paused = false;
  room.push();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "active");
  room.disconnect();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
  await expect.poll(() => room.sockets.length).toBe(2);
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "active");
  await page.keyboard.press("Escape");
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.claims).toEqual(["zilch"]);
  expect(gameActions(room)).toEqual([]);
});

test("Zilch spectators never receive or claim an onboarding offer", async ({ page }) => {
  const room = await harness(page, { game: "zilch", initial: zilchSnapshot(), spectator: true });
  await room.open();
  await expect(page.locator("[data-zilch-roll]")).toBeDisabled();
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.claims).toEqual([]);
  expect(gameActions(room)).toEqual([]);
});

for (const language of ["de", "en"]) {
  test(`Zilch ${language} mobile tour can close without holding, rolling or banking`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    const room = await harness(page, { game: "zilch", initial: zilchSnapshot(), language });
    await room.open();
    await expect(page.locator("[data-tour-start]")).toHaveText(language === "de" ? "Tour starten" : "Start tour");
    await startOfferedTour(page);
    await page.locator("[data-tour-next]").click();
    await page.locator("[data-tour-next]").click();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "select");
    const end = await page.locator("[data-tour-end]").boundingBox();
    expect(end.x).toBeGreaterThanOrEqual(0);
    expect(end.x + end.width).toBeLessThanOrEqual(321);
    expect(end.y + end.height).toBeLessThanOrEqual(741);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator("[data-tour-close]").click();
    await expect(page.locator(TOUR)).toBeHidden();
    expect(gameActions(room)).toEqual([]);
  });
}

for (const game of ["zdwa", "zilch"]) {
  test(`${game} tour keyboard buttons never invoke the room's game hotkeys`, async ({ page }) => {
    const room = await harness(page, { game, initial: game === "zilch" ? zilchSnapshot({ rolled: false }) : snapshot() });
    await room.open();
    await startOfferedTour(page);
    await page.locator("[data-tour-next]").focus();
    await page.keyboard.press("Space");
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", game === "zilch" ? "roll" : "hold");
    await page.locator("[data-tour-next]").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", game === "zilch" ? "select" : "roll");
    for (const key of ["r", "1", "a"]) await page.keyboard.press(key);
    if (game === "zdwa") {
      room.state._correction = { active: true, player_id: "p1", dice: [5, 5, 2, 3, 4] };
      room.push();
      await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(TOUR)).toBeHidden();
    // In particular Escape must not leak through to cancel_correction.
    expect(gameActions(room)).toEqual([]);
  });
}

test("Hausdepp offers its own guide once and dismissing it never plays a card", async ({ page }) => {
  const room = await harness(page, { game: "hausdepp", initial: hausdeppSnapshot(),
    games: { zdwa: "completed", zilch: "completed" } });
  await room.open();
  await expect(page.locator(`${TOUR}[data-tour-mode="offer"]`)).toBeVisible();
  expect(room.server.claims).toEqual(["hausdepp"]);
  await page.locator("[data-tour-dismiss]").click();
  await expect(page.locator(TOUR)).toBeHidden();
  await page.reload();
  await expect(page.locator("#hausdeppHand [data-card-id]")).toHaveCount(3);
  await expect.poll(() => room.server.requests.length).toBeGreaterThanOrEqual(2);
  await expect(page.locator(TOUR)).toBeHidden();
  expect(gameActions(room)).toEqual([]);
  expect(room.server.data.games).toEqual({ zdwa: "completed", zilch: "completed", hausdepp: "dismissed" });
});

test("Hausdepp Next explains hand, stock, pile and special cards without any real card action", async ({ page }) => {
  const room = await harness(page, { game: "hausdepp", initial: hausdeppSnapshot() });
  await room.open();
  await startOfferedTour(page);
  for (const step of ["play", "stock", "pile", "special", "finish"]) {
    await page.locator("[data-tour-next]").click();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", step);
    expect(gameActions(room)).toEqual([]);
  }
  await page.locator("[data-tour-next]").click();
  await expect(page.locator(TOUR)).toBeHidden();
  await expect.poll(() => room.server.data.games.hausdepp).toBe("completed");
  expect(gameActions(room)).toEqual([]);
  // The player's explicit card click still has the existing immediate behavior.
  await page.locator('#hausdeppHand [data-card-id="hearts-7"]').click();
  await expect.poll(() => gameActions(room).length).toBe(1);
  expect(gameActions(room)[0]).toMatchObject({ action: "hausdepp_play", cards: ["hearts-7"] });
});

test("Hausdepp waits through peeking and first offers the tour when a real own action is available", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const initial = hausdeppSnapshot();
  Object.assign(initial._hausdepp, { phase: "peeking", hand: [], available_actions: ["peek"], playable_cards: [] });
  const room = await harness(page, { game: "hausdepp", initial });
  await room.open();
  await expect(page.locator("#hausdeppStock")).toBeEnabled();
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.claims).toEqual([]);
  Object.assign(room.state, hausdeppSnapshot());
  room.state._hausdepp.version = 2;
  room.push();
  await expect(page.locator(`${TOUR}[data-tour-mode="offer"]`)).toBeVisible();
  expect(room.server.claims).toEqual(["hausdepp"]);
  expect(gameActions(room)).toEqual([]);
});

test("Hausdepp keeps tour exits available during opponent turns, pauses and reconnection", async ({ page }) => {
  const room = await harness(page, { game: "hausdepp", initial: hausdeppSnapshot() });
  await room.open();
  await startOfferedTour(page);
  await page.locator("[data-tour-next]").click();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "play");
  const actions = [...room.state._hausdepp.available_actions];
  room.state._hausdepp.available_actions = [];
  room.state._hausdepp.current_player_id = "p2";
  room.push();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
  await expect(page.locator("[data-tour-end]")).toBeVisible();
  room.state._hausdepp.available_actions = actions;
  room.state._hausdepp.current_player_id = "p1";
  room.state._paused = true;
  room.push();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
  room.state._paused = false;
  room.push();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "active");
  room.disconnect();
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "paused");
  await expect.poll(() => room.sockets.length).toBe(2);
  await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "active");
  await page.keyboard.press("Escape");
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.claims).toEqual(["hausdepp"]);
  expect(gameActions(room)).toEqual([]);
});

test("Hausdepp spectators never see the private hand tour or claim its offer", async ({ page }) => {
  const initial = hausdeppSnapshot();
  Object.assign(initial._hausdepp, { viewer_id: null, hand: [], available_actions: [], playable_cards: [] });
  const room = await harness(page, { game: "hausdepp", initial, spectator: true });
  await room.open();
  await expect(page.locator("#hausdeppStock")).toBeDisabled();
  await expect(page.locator(TOUR)).toBeHidden();
  expect(room.server.claims).toEqual([]);
  expect(gameActions(room)).toEqual([]);
});

for (const language of ["de", "en"]) {
  test(`Hausdepp ${language} mobile tour leaves playable cards and its own close button reachable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const room = await harness(page, { game: "hausdepp", initial: hausdeppSnapshot(), language });
    await room.open();
    await expect(page.locator("[data-tour-start]")).toHaveText(language === "de" ? "Tour starten" : "Start tour");
    await startOfferedTour(page);
    await page.locator("[data-tour-next]").click();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-step", "play");
    await page.locator('#hausdeppHand [data-card-id="hearts-7"]').click({ trial: true });
    const end = await page.locator("[data-tour-end]").boundingBox();
    expect(end.x + end.width).toBeLessThanOrEqual(321);
    expect(end.y + end.height).toBeLessThanOrEqual(741);
    await page.screenshot({ path: testInfo.outputPath(`hausdepp-tour-mobile-${language}.png`), animations: "disabled" });
    await page.locator("[data-tour-close]").click();
    await expect(page.locator(TOUR)).toBeHidden();
    expect(gameActions(room)).toEqual([]);
  });
}

test("settings can view all three guides without creating games, results or tour progress", async ({ page }) => {
  const room = await harness(page);
  const writes = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (!/^(GET|HEAD|OPTIONS)$/.test(request.method())
      && /^\/api\/(?:games(?:\/|$)|offline(?:\/|$)|.*(?:results|statistics))/.test(path)) writes.push(path);
  });
  await openSettings(page);
  for (const game of ["zdwa", "zilch", "hausdepp"]) {
    await page.locator(`[data-tour-action='view'][data-tour-game='${game}']`).click();
    await expect(page.locator(TOUR)).toHaveAttribute("data-tour-mode", "view");
    await expect(page.locator(TOUR)).toHaveAttribute("data-game-tour", game);
    await page.locator("[data-tour-next]").click();
    await page.locator("[data-tour-next]").click();
    await page.locator("[data-tour-end]").click();
    await expect(page.locator(TOUR)).toBeHidden();
  }
  expect(writes).toEqual([]);
  expect(room.actions).toEqual([]);
  expect(room.server.writes).toEqual([]);
  expect(room.server.data.games).toEqual({ zdwa: "unseen", zilch: "unseen", hausdepp: "unseen" });
});
