const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const { expectFixedTable, expectReachable } = require("./table-viewport");

test.use({ serviceWorkers: "block" });

function snapshot(game) {
  const players = [{ id: "p1", name: "Anna", user_id: 42, connected: true }, { id: "p2", name: "Ben", user_id: 43, connected: true }];
  return {
    _game_type: game, _name: "Hilfe am Spieltisch", _mode: "2", _play_mode: "multiplayer", _players: players,
    _participants: players.map(player => ({ ...player, type: "human" })), _players_joined: 2, _expected: 2,
    _started: true, _finished: false, _aborted: false, _paused: false, _offline_players: [], _connected: { p1: true, p2: true },
    _turn: { player_id: "p1", roll_index: 0 }, _dice: Array(game === "zilch" ? 6 : 5).fill(0), _holds: Array(game === "zilch" ? 6 : 5).fill(false),
    _rolls_used: 0, _rolls_max: 3, _scoreboards: { p1: {}, p2: {} }, _admin_edits: {}, _superadmin_active: false,
    _announced_row4: null, _correction: { active: false }, _teams: [], _results: null, _last_write_public: {}, _has_last: {}, _auto_single: false, _chat_history: [], suggestions: [],
    _target_score: 10000, _zilch_ruleset: "zilch-house-v1", _gameplay_status: "playable",
    _zilch_start_roll: { phase: "resolved", player_ids: ["p1", "p2"], pending_player_ids: [], rolls: { p1: 6, p2: 3 }, winner_id: "p1", version: 2 },
    _zilch_final_round: null, _round_points: { p1: 0, p2: 0 }, _total_points: { p1: 0, p2: 0 },
    _zilch_boards: Object.fromEntries(players.map(player => [player.id, { player_id: player.id, connected: true, active: player.id === "p1", total_points: 0, round_points: 0, zilch_streak: 0, rounds: [] }])),
    _zilch_turn_state: { turn_id: 1, version: 1, phase: "ready_to_roll", roll_id: 0, rolls_used: 0, available_dice_indices: [0, 1, 2, 3, 4, 5], held_dice_indices: [], committed_holds: [], round_points: 0, confirmation_required: false, confirmation_reasons: [], can_roll: true, can_select_hold: false, can_bank: false },
    _zilch_quick_holds: [], _zilch_last_event: null,
  };
}

for (const targetGame of ["zdwa", "zilch"]) test(`${targetGame.toUpperCase()}: real accounts request scoped help, reclaim after returning, and preserve the original seat`, async ({ browser, baseURL }) => {
  test.setTimeout(60000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const accounts = [];
    for (const [index, page] of pages.entries()) {
      const seed = await page.request.post("/api/auth/login", { data: { username: "Admin", password: "temporary-password-123" } });
      expect(seed.ok()).toBeTruthy();
      const root = (await seed.json()).user;
      const username = targetGame === "zilch" ? (index ? "HelpFlowZilchAdmin" : "adminhelp_zilch") : (index ? "HelpFlowAdmin" : "HelpFlowPlayer");
      const password = "help-flow-password-123";
      expect((await page.request.post("/api/admin/users", {
        headers: { "X-CSRF-Token": root.csrf_token }, data: { username, temporary_password: password, role: index ? "admin" : "user" },
      })).status()).toBe(201);
      const login = await page.request.post("/api/auth/login", { data: { username, password } });
      const first = (await login.json()).user;
      expect((await page.request.put("/api/auth/preferences/language", { headers: { "X-CSRF-Token": first.csrf_token }, data: { preferred_language: "en" } })).ok()).toBeTruthy();
      expect((await page.request.post("/api/auth/change-password", {
        headers: { "X-CSRF-Token": first.csrf_token }, data: { current_password: password, new_password: `${password}-final` },
      })).ok()).toBeTruthy();
      const signedIn = await page.request.post("/api/auth/login", { data: { username, password: `${password}-final` } });
      accounts.push((await signedIn.json()).user);
      await page.route("**/api/releases**", route => route.fulfill({ json: { releases: [], viewer_id: first.id, can_prompt: false } }));
      // Canonical cross-product links use the production hostname. Only map
      // that navigation to the local product bridge; auth, APIs and sockets
      // continue to use the real test server and its access policy.
      await page.route("https://zilch.zockdiewandan.online/**", route => {
        const url = new URL(route.request().url());
        return route.fulfill({ status: 302, headers: { location: `${baseURL}/zilch${url.pathname}${url.search}` } });
      });
      await page.addInitScript(() => localStorage.setItem("zdwa_language", "en"));
      await page.setViewportSize(index ? { width: 1366, height: 900 } : { width: 390, height: 844 });
    }
    const [player, admin] = pages;
    const gameIds = [];
    for (const [index, page] of pages.entries()) {
      const created = await page.request.post("/api/games", {
        headers: { "X-CSRF-Token": accounts[index].csrf_token }, data: { name: index ? "Admin origin" : "Private solo help", mode: 1, ...(index ? {} : { game_type: targetGame, ...(targetGame === "zilch" ? { play_mode: "solo" } : { pass: "help-private" }) }) },
      });
      expect(created.ok()).toBeTruthy();
      const { game_id: id } = await created.json();
      gameIds.push(id);
      expect((await (await page.request.get(`/api/games/${id}`)).json()).locked).toBe(!index && targetGame === "zdwa");
      await page.goto(`${!index && targetGame === "zilch" ? "/zilch" : ""}/spiel/${id}?name=${accounts[index].username}${index ? "" : "&pass=help-private"}`);
      if (!index && targetGame === "zilch") {
        await expect(page.locator(".zilch-play-layout--solo")).toBeVisible();
      } else await expect(page.locator(".player-card.me")).toBeVisible();
    }
    const originalStorage = await admin.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith("wuerfler_pid_") || key.startsWith("wuerfler_token_"))));
    expect(Object.keys(originalStorage)).toHaveLength(2);
    await (await openHelpButton(player, targetGame)).click();
    await expect(player.locator(".admin-help-bar")).toContainText("You can keep playing");
    await admin.evaluate(() => window.__adminHelpController.refresh());
    await expect(admin.locator(".admin-help-bar")).toContainText(accounts[0].username);
    await admin.screenshot({ path: `/tmp/rtd-admin-help-real-${targetGame}-desktop-cta.png` });
    await expect(admin).toHaveURL(new RegExp(`/spiel/${gameIds[1]}$`));
    await admin.getByRole("button", { name: "Take request", exact: true }).click();
    await expect(admin).toHaveURL(new RegExp(`/spiel/${gameIds[0]}/zuschauen\\?help_request=`));
    await expect(admin.locator(targetGame === "zilch" ? ".zilch-play-layout--solo" : ".player-card").first()).toBeVisible();
    if (targetGame === "zilch") {
      expect((await (await admin.request.get("/api/auth/me")).json()).game_access.zilch_preview).toBe(false);
      await expect(admin.locator("[data-game-switch]")).toBeHidden();
      await expect(admin.locator("[data-zilch-roll]")).toBeDisabled();
      await admin.setViewportSize({ width: 390, height: 844 });
      await admin.screenshot({ path: "/tmp/rtd-admin-help-real-zilch-solo-mobile.png" });
    }
    await expect(admin.locator("[data-admin-help-call]")).toBeHidden();
    await expect(admin.locator(".app-dialog-backdrop:visible")).toHaveCount(0);
    const helpId = new URL(admin.url()).searchParams.get("help_request");
    const metadata = await (await admin.request.get(`/api/games/${gameIds[0]}`)).json();
    expect(metadata).toMatchObject({ admin_help_access: true, locked: false });
    const unrelated = await player.request.post("/api/games", { data: { name: "Unrelated private solo", mode: 1, game_type: targetGame, ...(targetGame === "zilch" ? { play_mode: "solo" } : { pass: "not-for-admin" }) } });
    const { game_id: unrelatedId } = await unrelated.json();
    expect((await (await admin.request.get(`/api/games/${unrelatedId}`)).json()).admin_help_access).not.toBe(true);
    if (targetGame === "zilch") expect((await admin.request.get(`/zilch/spiel/${unrelatedId}/zuschauen`)).status()).toBe(403);
    await admin.getByRole("button", { name: "Back to your game", exact: true }).click();
    await expect(admin).toHaveURL(new RegExp(`/spiel/${gameIds[1]}$`));
    await expect(admin.locator(".player-card.me")).toBeVisible();
    await admin.getByRole("button", { name: "Go to help", exact: true }).click();
    await expect(admin).toHaveURL(new RegExp(`/spiel/${gameIds[0]}/zuschauen\\?help_request=${helpId}$`));
    await admin.getByRole("button", { name: "Close request", exact: true }).click();
    await admin.locator('[data-dialog-action="accidental"]').click();
    await expect(admin.locator(".admin-help-bar")).toContainText("Your game is waiting");
    if (targetGame === "zilch") await admin.evaluate(() => window.ZDWA_APP_MODE.refresh());
    await expect(admin.locator(".admin-help-bar")).toContainText("Your game is waiting");
    await expect(admin).toHaveURL(new RegExp(`/spiel/${gameIds[0]}/zuschauen\\?help_request=${helpId}$`));
    await expect(admin.locator(".app-dialog-backdrop:visible")).toHaveCount(0);
    await admin.getByRole("button", { name: "Back to your game", exact: true }).click();
    await expect(admin).toHaveURL(new RegExp(`/spiel/${gameIds[1]}$`));
    await expect(admin.locator(".player-card.me")).toBeVisible();
    expect(await admin.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith("wuerfler_pid_") || key.startsWith("wuerfler_token_"))))).toEqual(originalStorage);
    await player.evaluate(() => window.__adminHelpController.refresh());
    await expect(player.locator(".admin-help-bar")).toHaveCount(0);
    expect((await (await player.request.get(`/api/admin-help/status?game_id=${gameIds[0]}`)).json()).blocked).toBe(false);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

async function fixture(page, { game = "zdwa", language = "de", admin = false, guest = false, bans = [], viewport = { width: 390, height: 844 } } = {}) {
  await page.setViewportSize(viewport);
  const gameId = `help-ui-${game}`;
  const prefix = game === "zilch" ? "/zilch" : "";
  const room = `${prefix}/spiel/${gameId}`;
  const user = { id: 42, username: "Anna", is_admin: admin, role: admin ? "admin" : "player", csrf_token: "help-ui-csrf", bans, preferences: { preferred_language: language, friend_activity_enabled: false, lobby_chat_enabled: false } };
  const auth = { authenticated: !guest, user: guest ? null : user, game_access: { zilch_preview: true, zilch_public: true }, passkeys: { enabled: false }, registration: { turnstile_enabled: false, email_enabled: false } };
  const state = { request: null, requests: [], active_claim: null, blocked: false, return_to_game: null, posts: [], pushCalls: [], adminHelpPush: true };
  await page.addInitScript(({ game, language }) => {
    localStorage.setItem("zdwa_language", language);
    localStorage.setItem(game === "zilch" ? "zilch_theme" : "wuerfler_theme", game === "zilch" ? "lcars" : "light");
  }, { game, language });
  await page.route("**/api/auth/me", route => route.fulfill({ json: auth }));
  await page.route("**/api/releases**", route => route.fulfill({ json: { releases: [], viewer_id: guest ? null : 42 } }));
  await page.route("**/api/admin-help**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { authenticated: !guest, is_admin: admin, ...state } });
    }
    const body = route.request().postDataJSON();
    state.posts.push({ path: url.pathname, body });
    expect(route.request().headers()["x-csrf-token"]).toBe("help-ui-csrf");
    if (url.pathname.endsWith("/claim")) {
      state.active_claim = { ...state.requests[0], status: "claimed", claimed_by: { id: 42, username: "Anna" }, origin_game_id: gameId, return_url: room };
      return route.fulfill({ json: { request: state.active_claim, help_url: `${room}-target/zuschauen?help_request=h1`, return_url: room } });
    }
    if (url.pathname.endsWith("/resolve")) {
      state.active_claim = null;
      state.requests = [];
      state.return_to_game = { request_id: "h1", url: room };
      state.socket?.send(JSON.stringify({ error: "Der Admin-Einsatz ist beendet.", error_code: "admin_help_completed", fatal: true }));
      return route.fulfill({ json: { request: { id: "h1", status: "resolved" } } });
    }
    if (url.pathname.endsWith("/return")) {
      state.return_to_game = null;
      if (state.active_claim) state.active_claim = { ...state.active_claim, origin_game_id: null, return_url: null };
      return route.fulfill({ json: { return_url: room } });
    }
    state.request = { id: "own", game_id: gameId, game_type: game, requester: { id: 42, username: "Anna" }, status: "open" };
    return route.fulfill({ json: { request: state.request } });
  });
  const roomHtml = await readFile(`app/static/${game === "zilch" ? "zilch" : "room"}.html`, "utf8");
  await page.route(`**${room}**`, route => route.fulfill({ contentType: "text/html", body: roomHtml }));
  await page.route(`**/api/games/${gameId}**`, route => route.fulfill({ json: {
    exists: true, game_type: game, name: "Hilfe am Spieltisch", mode: "2", play_mode: "multiplayer", locked: true,
    admin_help_access: true, spectator_available: true, player_statuses: [],
  } }));
  await page.routeWebSocket(new RegExp(`/ws/${gameId}(?:-target)?$`), socket => {
    state.socket = socket;
    socket.onMessage(raw => {
      const action = JSON.parse(String(raw)).action;
      if (["join_game", "rejoin_game", "spectate_game"].includes(action)) {
        socket.send(JSON.stringify({ auth, ...(action === "spectate_game" ? { spectator_id: "s1" } : { player_id: "p1" }), scoreboard: snapshot(game) }));
      }
    });
  });
  const pushStatus = () => ({ available: true, subscribed: true, enabled: true, is_admin: admin, admin_help_enabled: state.adminHelpPush,
    game_invites_enabled: true, daily_reminder_enabled: false, release_notifications_enabled: true });
  await page.route("**/api/web-push/subscription", route => route.fulfill({ json: pushStatus() }));
  await page.route("**/api/web-push/preferences", route => {
    const data = route.request().postDataJSON();
    state.pushCalls.push(data);
    state.adminHelpPush = data.admin_help_enabled;
    return route.fulfill({ json: pushStatus() });
  });
  return { state, room, prefix, gameId, async account() {
    const html = await readFile(`app/static/${game === "zilch" ? "zilch" : "account"}.html`, "utf8");
    await page.route(`**${prefix}/konto*`, route => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto(`${prefix}/konto#settings`);
  } };
}

async function openHelpButton(page, game) {
  if (game === "zdwa") await page.locator("#roomHeaderMenuToggle").click();
  return page.locator("[data-admin-help-call]");
}

for (const game of ["zdwa", "zilch"]) {
  for (const language of ["de", "en"]) {
    test(`${game} ${language}: players request help once and keep all game controls reachable`, async ({ page }) => {
      const { state, room, gameId } = await fixture(page, { game, language });
      await page.goto(`${room}?name=Anna`);
      const button = await openHelpButton(page, game);
      await expect(button).toBeVisible();
      await button.click();
      await expect.poll(() => state.posts.length).toBe(1);
      expect(state.posts[0].body).toEqual({ game_id: gameId });
      await expect(page.locator(".admin-help-bar")).toContainText(language === "de" ? "Du kannst weiterspielen" : "You can keep playing");
      await expect(page).toHaveURL(new RegExp(`/spiel/${gameId}`));
      await expect(page.locator(".app-dialog-backdrop:visible")).toHaveCount(0);
      for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1024, height: 1366 }, { width: 1366, height: 900 }]) {
        await page.setViewportSize(viewport);
        await expectFixedTable(page, game === "zilch" ? [".zilch-header", ".zilch-dice-dock"] : [".room-header", ".topbar"]);
        await expectReachable(page, game === "zilch" ? "#zilchLeaveGameBtn" : "#rollBtnInline");
        if (language === "en" && [390, 1366].includes(viewport.width)) await page.screenshot({ path: `/tmp/rtd-admin-help-${game}-${viewport.width}.png` });
      }
      if (game === "zdwa") await page.locator("#roomHeaderMenuToggle").click();
      await expect(button).toBeDisabled();
      expect(state.posts).toHaveLength(1);
    });

    test(`${game} ${language}: guests get an in-app login choice instead of sending help`, async ({ page }) => {
      const { state, room } = await fixture(page, { game, language, guest: true });
      await page.goto(`${room}?name=Anna`);
      await (await openHelpButton(page, game)).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("dialog")).toContainText(language === "de" ? "Bitte melde dich an" : "Please sign in");
      await page.locator('[data-dialog-action="cancel"]').click();
      expect(state.posts).toHaveLength(0);
    });
  }

  test(`${game}: admins take, resolve and return from help without automatic navigation`, async ({ page }) => {
    const { state, room, gameId } = await fixture(page, { game, admin: true });
    state.requests = [{ id: "h1", game_id: `${gameId}-target`, game_type: game, status: "open", requester: { id: 43, username: "Ben" }, requester_user_id: 43 }];
    await page.goto(`${room}?name=Anna`);
    await expect(page.locator(".admin-help-bar")).toContainText("Ben");
    await expect(page).not.toHaveURL(/help_request/);
    await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
    await expect(page).toHaveURL(/zuschauen\?help_request=h1$/);
    expect(state.posts[0].body).toEqual({ current_game_id: gameId });
    await expect(page.locator("[data-admin-help-call]")).toBeHidden();
    await page.getByRole("button", { name: "Zur eigenen Partie", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${room}$`));
    await expect(page.getByRole("button", { name: "Zur eigenen Partie", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Zur Hilfe", exact: true }).click();
    await expect(page).toHaveURL(/zuschauen\?help_request=h1$/);
    expect(state.posts.filter(call => call.path.endsWith("/claim"))).toEqual([
      { path: "/api/admin-help/h1/claim", body: { current_game_id: gameId } },
      { path: "/api/admin-help/h1/claim", body: { current_game_id: gameId } },
    ]);
    await page.getByRole("button", { name: "Abschließen", exact: true }).click();
    await page.locator('[data-dialog-action="accidental"]').click();
    await expect.poll(() => state.posts.some(call => call.body.outcome === "accidental")).toBe(true);
    await expect(page.locator(".admin-help-bar")).toContainText("Deine Partie wartet");
    await expect(page.locator(".app-dialog-backdrop:visible")).toHaveCount(0);
    await page.screenshot({ path: `/tmp/rtd-admin-help-${game}-return.png` });
    await page.getByRole("button", { name: "Zur eigenen Partie", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${room}$`));
    expect(state.posts.at(-1).path).toBe("/api/admin-help/h1/return");
  });

  test(`${game}: admin push preference is independent and account bans show translated expiry and reason`, async ({ page }) => {
    const { state, account } = await fixture(page, { game, language: "en", admin: true,
      bans: [{ scope: "help", reason: "admin_help_misuse", expires_at: "2099-09-22T13:00:00Z" }, { scope: "play", reason: "Repeated cheating", expires_at: null }] });
    await account();
    await expect(page.locator("[data-account-bans]")).toContainText("Admin help blocked");
    await expect(page.locator("[data-account-bans]")).toContainText("Misuse of admin help");
    await expect(page.locator("[data-account-bans]")).toContainText("2099");
    await expect(page.locator("[data-account-bans]")).toContainText("Permanently");
    const group = page.locator('details[data-account-section="social"]');
    if (await group.count() && await group.getAttribute("open") === null) await group.locator(":scope > summary").click();
    const checkbox = page.locator('input[name="adminHelp"]');
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await checkbox.locator("xpath=ancestor::form").getByRole("button", { name: "Save push preferences" }).click();
    await expect.poll(() => state.pushCalls.length).toBe(1);
    expect(state.pushCalls[0]).toMatchObject({ admin_help_enabled: false, game_invites_enabled: true, daily_reminder_enabled: false, release_notifications_enabled: true });
    await expect(checkbox).not.toBeChecked();
  });
}
