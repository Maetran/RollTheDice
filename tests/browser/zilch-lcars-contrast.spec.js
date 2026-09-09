const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

function gameSnapshot(held = false) {
  const players = [
    { id: "p1", name: "Mani", type: "human", user_id: 2, connected: true },
    { id: "p2", name: "CPU", type: "cpu", user_id: null, connected: true, cpu_strategy: "conservative" },
  ];
  const boards = Object.fromEntries(players.map((player, index) => [player.id, {
    player_id: player.id, active: index === 0, connected: true,
    total_points: index ? 3200 : 6400, round_points: index ? 0 : 600, zilch_streak: 0,
    rounds: Array.from({ length: 32 }, (_, round) => ({
      round: round + 1, event: "bank", points: index ? 100 : 200,
      total_after: (round + 1) * (index ? 100 : 200),
    })),
  }]));
  return {
    _game_type: "zilch", _name: "LCARS-Kontrast", _mode: "2", _play_mode: "cpu",
    _players: [players[0]], _participants: players, _players_joined: 2, _expected: 2,
    _started: true, _finished: false, _aborted: false, _paused: false, _offline_players: [],
    _target_score: 10000, _zilch_ruleset: "zilch-house-v1", _gameplay_status: "playable",
    _turn: { player_id: "p1" }, _dice: [1, 2, 3, 4, 5, 6], _rolls_used: 1,
    _holds: [held, false, false, false, false, false],
    _zilch_start_roll: { phase: "resolved", player_ids: ["p1", "p2"], pending_player_ids: [], rolls: { p1: 6, p2: 2 }, winner_id: "p1", version: 2 },
    _zilch_final_round: { triggered_by: null, pending_player_ids: [] }, _chat_history: [],
    _zilch_boards: boards, _round_points: { p1: 600, p2: 0 }, _total_points: { p1: 6400, p2: 3200 },
    _zilch_turn_state: {
      turn_id: 65, version: held ? 2 : 1, phase: held ? "ready_to_roll" : "awaiting_hold", roll_id: 1, rolls_used: 1,
      available_dice_indices: held ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5], held_dice_indices: held ? [0] : [],
      committed_holds: held ? [{ id: "single-one", points: 100 }] : [], round_points: 600,
      confirmation_required: false, confirmation_reasons: [], can_roll: held, can_select_hold: !held,
      can_bank: held, bank_block_reason: held ? "" : "zilch_hold_required",
    },
    _zilch_quick_holds: held ? [] : [{
      id: "single-one", combination_type: "single_one", dice_indices: [0], dice_values: [1], points: 100,
      label_key: "zilch.option.single_one", label_params: { count: 1 }, roll_id: 1,
      requires_confirmation: false, hot_dice: false, free_roll: false, all_available_dice: false,
    }],
    _zilch_last_event: null,
  };
}

async function installFixture(page) {
  // Same isolated real-shell/socket seam as the notebook regression suite;
  // no production export or test hook is added to the application bundle.
  const gameId = "lcars-contrast-fixture";
  const html = await readFile(path.join(__dirname, "../../app/static/zilch.html"), "utf8");
  await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    authenticated: true,
    user: { id: 2, username: "Mani", csrf_token: "fixture-csrf", preferences: { preferred_language: "de" } },
    game_access: { zilch_preview: true, zilch_public: false },
  } }));
  await page.route(`**/api/games/${gameId}`, route => route.fulfill({ json: {
    exists: true, game_type: "zilch", name: "LCARS-Kontrast", mode: "2", play_mode: "cpu", locked: false, player_statuses: [],
  } }));
  await page.addInitScript(({ game, initial }) => {
    localStorage.setItem("zilch_theme", "lcars");
    class FixtureSocket {
      constructor(url) {
        this.url = url; this.readyState = 0; this.listeners = new Map();
        if (new URL(url, location.href).pathname === `/ws/${game}`) {
          window.__pushContrastSnapshot = next => this.emit("message", { data: JSON.stringify({ scoreboard: next }) });
        }
        setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0);
      }
      addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
      emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
      send(raw) {
        if (["join_game", "rejoin_game"].includes(JSON.parse(raw).action)) {
          setTimeout(() => this.emit("message", { data: JSON.stringify({ player_id: "p1", scoreboard: initial }) }), 0);
        }
      }
      close() { this.readyState = 3; this.emit("close", {}); }
    }
    Object.assign(FixtureSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = FixtureSocket;
  }, { game: gameId, initial: gameSnapshot() });
  await page.goto(`/zilch/spiel/${gameId}`);
  await expect(page.locator("[data-zilch-board-id]")).toHaveCount(2);
  await page.evaluate(() => {
    const visit = rules => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes("display-mode: standalone")) rule.media.mediaText = "all";
        if (rule.cssRules) visit(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) visit(sheet.cssRules);
  });
}

function rgb(color) {
  const channels = color.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) throw new Error(`Unexpected computed color: ${color}`);
  return channels.slice(0, 3);
}

function luminance(color) {
  const channels = rgb(color).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

async function roomColors(page) {
  return page.evaluate(() => {
    const read = selector => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      return {
        color: style.color, background: style.backgroundColor, image: style.backgroundImage,
        border: style.borderLeftColor, shadow: style.boxShadow, opacity: style.opacity,
      };
    };
    const score = document.querySelector(".zilch-notebook-player.is-active .zilch-notebook-entry__change");
    return {
      positive: { color: getComputedStyle(score).color, background: getComputedStyle(score.closest("article")).backgroundColor },
      body: read("body"), badge: read(".zilch-participant-badge--cpu"),
      notebook: read(".zilch-score-notebook"), header: read(".zilch-header"),
      chat: read(".zilch-chat__toggle"), bank: read("[data-zilch-bank]"),
      total: read(".zilch-notebook-player.is-active .zilch-notebook-total"),
    };
  });
}

async function dieStyles(die, pseudo = null) {
  return die.evaluate((element, before) => {
    const style = getComputedStyle(element, before);
    return {
      borderWidth: parseFloat(style.borderTopWidth), borderColor: style.borderTopColor,
      shadow: style.boxShadow, filter: style.filter, opacity: Number(style.opacity),
      outlineWidth: parseFloat(style.outlineWidth), outlineColor: style.outlineColor, outlineStyle: style.outlineStyle,
      color: style.color, background: style.backgroundColor, content: style.content,
      width: parseFloat(style.width), focusVisible: element.matches(":focus-visible"),
    };
  }, pseudo);
}

test("LCARS room frames and chat are subdued while score ink and flat CPU labels remain readable", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await installFixture(page);
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      const colors = await roomColors(page);
      const metrics = {
        ...colors,
        positiveContrast: contrast(colors.positive.color, colors.positive.background),
        badgeContrast: colors.badge.image === "none" ? contrast(colors.badge.color, colors.badge.background) : null,
        chatContrast: contrast(colors.chat.color, colors.chat.background),
      };
      const screenshot = testInfo.outputPath(`lcars-contrast-${viewport.width}.png`);
      await page.screenshot({ path: screenshot });
      await testInfo.attach(`lcars-contrast-${viewport.width}`, { path: screenshot, contentType: "image/png" });
      await testInfo.attach(`contrast-${viewport.width}.json`, { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
      expect.soft(metrics.positiveContrast).toBeGreaterThanOrEqual(4.5);
      expect.soft(colors.positive.color).not.toBe("rgb(154, 55, 30)");
      expect.soft(colors.badge.image).toBe("none");
      expect.soft(colors.badge.shadow).toBe("none");
      if (metrics.badgeContrast !== null) expect.soft(metrics.badgeContrast).toBeGreaterThanOrEqual(4.5);
      expect.soft(luminance(colors.badge.color), "dark CPU badge lettering").toBeLessThan(0.05);
      expect.soft(luminance(colors.badge.background), "CPU badge is a mid-tone panel").toBeGreaterThan(0.12);
      expect.soft(luminance(colors.badge.background)).toBeLessThan(0.55);
      expect.soft(luminance(colors.notebook.border), "notebook frame is quieter than the original lilac").toBeLessThan(luminance("rgb(205, 168, 219)") * 0.8);
      expect.soft(luminance(colors.header.border), "header rail is quieter than the original cyan").toBeLessThan(luminance("rgb(139, 215, 235)") * 0.8);
      expect.soft(luminance(colors.chat.background), "chat is visually secondary to the bank action").toBeLessThan(luminance(colors.bank.background) * 0.8);
      expect.soft(metrics.chatContrast).toBeGreaterThanOrEqual(4.5);
      expect.soft(contrast(colors.body.color, colors.body.background), "general text must not be dimmed").toBeGreaterThanOrEqual(7);
      expect.soft(contrast(colors.total.color, colors.positive.background)).toBeGreaterThanOrEqual(4.5);
      expect.soft(colors.body.opacity).toBe("1");
    }
  } finally { await context.close(); }
});

test("LCARS dice lose gold halos but keep selection, held checks, keyboard focus, and a clear steady roll action", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await installFixture(page);
    const die = page.locator('[data-zilch-die-index="0"]');
    const unselected = await dieStyles(die);
    expect.soft(unselected.borderWidth, "no inherited Classic gold outer border").toBe(0);
    expect.soft(unselected.shadow).toBe("none");
    expect.soft(unselected.filter).toBe("none");
    const stroke = await die.locator(".zilch-die__body").evaluate(element => getComputedStyle(element).stroke);
    expect.soft(luminance(stroke), "quieter SVG body outline").toBeLessThan(luminance("rgb(138, 188, 255)") * 0.9);
    await die.click();
    await page.mouse.move(1, 1);
    await expect(die).toHaveAttribute("aria-pressed", "true");
    const selected = await dieStyles(die);
    const selectedOutline = await dieStyles(die, "::before");
    expect.soft(selected.borderWidth).toBe(0);
    expect.soft(selected.shadow).toBe("none");
    expect.soft(selectedOutline.shadow).toBe("none");
    expect.soft(selectedOutline.borderWidth).toBeGreaterThanOrEqual(2);
    expect.soft(contrast(selectedOutline.borderColor, "rgb(0, 0, 0)")).toBeGreaterThanOrEqual(3);
    expect.soft(selectedOutline.opacity).toBe(1);
    await die.click();
    await expect(die).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Tab");
    await die.focus();
    const focus = await dieStyles(die);
    expect(focus.focusVisible).toBe(true);
    expect(focus.outlineStyle).toBe("solid");
    expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(contrast(focus.outlineColor, "rgb(0, 0, 0)")).toBeGreaterThanOrEqual(3);
    await page.evaluate(next => window.__pushContrastSnapshot(next), gameSnapshot(true));
    const held = page.locator(".zilch-die--held").first();
    await expect(held).toBeVisible();
    const check = await dieStyles(held, "::after");
    expect(check.content).toContain("✓");
    expect(check.width).toBeGreaterThanOrEqual(12);
    expect(contrast(check.color, check.background)).toBeGreaterThanOrEqual(4.5);
    const roll = page.locator("[data-zilch-roll]");
    await expect(roll).toBeEnabled();
    await expect(roll).toHaveClass(/is-roll-ready/);
    const ready = await roll.evaluate(element => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor, shadow: style.boxShadow, animation: style.animationName, opacity: style.opacity };
    });
    expect.soft(ready.animation).toBe("none");
    expect.soft(ready.shadow).toBe("none");
    expect.soft(contrast(ready.color, ready.background)).toBeGreaterThanOrEqual(4.5);
    expect(ready.opacity).toBe("1");
    await testInfo.attach("dice-states.json", { body: JSON.stringify({ unselected, selected, selectedOutline, focus, check, ready }, null, 2), contentType: "application/json" });
    const screenshot = testInfo.outputPath("lcars-held-and-ready-mobile.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("lcars-held-and-ready-mobile", { path: screenshot, contentType: "image/png" });
  } finally { await context.close(); }
});

test("the LCARS contrast refinement does not recolor Classic scores, badges, or dice", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await installFixture(page);
    await page.locator("[data-theme-toggle]").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const colors = await roomColors(page);
    expect(colors.positive.color).toBe("rgb(154, 55, 30)");
    expect(colors.badge.image).toContain("linear-gradient");
    expect((await dieStyles(page.locator('[data-zilch-die-index="0"]'))).borderWidth).toBe(1);
  } finally { await context.close(); }
});
