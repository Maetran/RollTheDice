const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

const publicGames = {
  zilch_public: true, zilch_preview: false,
  hausdepp_public: true, hausdepp_preview: false,
  watten_public: true, watten_preview: false,
};

function identity(capabilities = {}, language = "de") {
  return {
    authenticated: true,
    user: {
      id: 87, username: "LabelledPickerAccount", is_admin: false,
      is_owner: false, is_founder: false, analytics_access: false,
      can_view_analytics: false, must_change_password: false,
      ...capabilities, preferences: { preferred_language: language },
    },
    game_access: { ...publicGames },
  };
}

async function pickerFixture(page, auth, language = "de", pathname = "/regeln") {
  await page.addInitScript(language => {
    localStorage.setItem("zdwa_language", language);
    if (!sessionStorage.getItem("labelled-picker-fixture-seeded")) {
      localStorage.setItem("zdwa_app_mode", "hausdepp");
      sessionStorage.setItem("labelled-picker-fixture-seeded", "true");
    }
  }, language);
  const state = { auth, fail: false, authCalls: 0, adminMutations: [] };
  // This labelled projection exercises the real shared shell and picker.
  // Backend authorization is covered with real accounts in analytics-dashboard
  // and admin-ownership; no session or server permission is granted here.
  await page.route("**/api/auth/me", route => {
    state.authCalls += 1;
    return state.fail
      ? route.fulfill({ status: 503, json: { detail: "Labelled identity outage" } })
      : route.fulfill({ json: state.auth });
  });
  await page.route("**/api/game-activity", route => route.fulfill({ json: {
    games: Object.fromEntries(["zdwa", "zilch", "hausdepp", "watten"].map(id => [id, { players: 2 }])),
  } }));
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/admin/")
        && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      state.adminMutations.push({ url: request.url(), method: request.method() });
    }
  });
  await page.goto(pathname);
  await expect.poll(() => page.evaluate(() => Boolean(window.ZDWA_APP_MODE?.initialized))).toBe(true);
  await page.evaluate(() => window.ZDWA_APP_MODE.refresh());
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  return state;
}

async function openPicker(page) {
  const trigger = page.locator("[data-game-switch]");
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const menu = page.locator("#suiteGameMenu");
  await expect(menu).toBeVisible();
  await menu.evaluate(node => Promise.all(node.getAnimations({ subtree: true })
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))));
  return menu;
}

async function expectUtilities(menu, expected, language = "de") {
  await expect(menu.locator("a[data-game-entry]")).toHaveCount(4);
  await expect(menu.locator("a[data-suite-utility-entry]")).toHaveCount(expected.length);
  const heading = menu.getByRole("heading", {
    name: language === "de" ? "Verwaltung" : "Administration", exact: true,
  });
  if (expected.length) await expect(heading).toBeVisible();
  else await expect(heading).toHaveCount(0);
  for (const id of ["admin", "dashboard"]) {
    const entry = menu.locator(`a[data-suite-utility-entry="${id}"]`);
    if (!expected.includes(id)) {
      await expect(entry).toHaveCount(0);
      continue;
    }
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAccessibleName(id === "admin" ? "Admin Center" : "Dashboard");
    await expect(entry).toHaveAttribute("href", id === "admin" ? "/admin" : "/admin/dashboard");
    await expect(entry).not.toHaveAttribute("aria-current", "page");
    await expect(entry).not.toHaveAttribute("data-game-entry");
    await expect(entry.locator("[data-game-activity]")).toHaveCount(0);
  }
}

const accounts = [
  { name: "regular account", flags: {}, utilities: [] },
  { name: "admin without analytics", flags: { is_admin: true }, utilities: ["admin"] },
  { name: "analytics viewer without admin", flags: { analytics_access: true, can_view_analytics: true }, utilities: ["dashboard"] },
  { name: "owner without analytics", flags: { is_admin: true, is_owner: true }, utilities: ["admin"] },
  { name: "owner with analytics", flags: { is_admin: true, is_owner: true, analytics_access: true, can_view_analytics: true }, utilities: ["admin", "dashboard"] },
  { name: "founder", flags: { is_admin: true, is_owner: true, is_founder: true, can_view_analytics: true }, utilities: ["admin", "dashboard"] },
];

for (const language of ["de", "en"]) {
  for (const account of accounts) {
    test(`${language}: shared picker independently exposes utilities for ${account.name}`, async ({ page }) => {
      const state = await pickerFixture(page, identity(account.flags, language), language);
      const url = page.url();
      const menu = await openPicker(page);
      await expectUtilities(menu, account.utilities, language);
      await expect(menu.locator('[data-game-entry="zdwa"]')).toHaveAttribute("aria-current", "page");
      expect(page.url()).toBe(url);
      expect(await page.evaluate(() => localStorage.getItem("zdwa_app_mode"))).toBe("hausdepp");
      expect(state.adminMutations).toEqual([]);
    });
  }
}

test("public Watten remains discoverable when identity failure withdraws utility links and releases the mobile modal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await pickerFixture(page, identity({ is_admin: true, can_view_analytics: true }), "de", "/hausdepp/regeln");
  let menu = await openPicker(page);
  await expectUtilities(menu, ["admin", "dashboard"]);
  await expect(menu).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  const previousCalls = state.authCalls;
  state.fail = true;
  await page.evaluate(() => window.ZDWA_APP_MODE.refresh());
  expect(state.authCalls).toBeGreaterThan(previousCalls);
  await expect(menu).toHaveCount(0);
  await expect(page.locator("[data-game-picker-backdrop]")).toHaveCount(0);
  expect(await page.locator("[data-game-switch]").evaluate(node => Boolean(node.closest("[inert]")))).toBe(false);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  menu = await openPicker(page);
  await expectUtilities(menu, []);
  await expect(menu.locator('[data-game-entry="watten"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-game-switch]")).toBeFocused();
  state.fail = false;
  await page.evaluate(() => window.ZDWA_APP_MODE.refresh());
  menu = await openPicker(page);
  await expectUtilities(menu, ["admin", "dashboard"]);
  expect(state.adminMutations).toEqual([]);
});

test("same-account capability revocation and account changes update utilities without granting the other capability", async ({ page }) => {
  const state = await pickerFixture(page, identity({ is_admin: true, can_view_analytics: true }));
  let menu = await openPicker(page);
  await expectUtilities(menu, ["admin", "dashboard"]);
  state.auth = identity({ is_admin: true, can_view_analytics: false });
  await page.evaluate(() => window.ZDWA_APP_MODE.refresh());
  await expect(page.locator('[data-suite-utility-entry="dashboard"]')).toHaveCount(0);
  if (!await menu.count()) menu = await openPicker(page);
  await expectUtilities(menu, ["admin"]);
  await page.keyboard.press("Escape");
  state.auth = identity({ id: 88, can_view_analytics: true });
  await page.evaluate(async auth => {
    window.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: auth }));
    await window.ZDWA_APP_MODE.refresh();
  }, state.auth);
  menu = await openPicker(page);
  await expectUtilities(menu, ["dashboard"]);
  await page.keyboard.press("Escape");
  state.auth = { authenticated: false, user: null, game_access: { ...publicGames } };
  await page.evaluate(async auth => {
    window.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: auth }));
    await window.ZDWA_APP_MODE.refresh();
  }, state.auth);
  menu = await openPicker(page);
  await expectUtilities(menu, []);
  expect(await page.evaluate(() => localStorage.getItem("zdwa_app_mode"))).toBe("hausdepp");
  expect(state.adminMutations).toEqual([]);
});

for (const id of ["admin", "dashboard"]) {
  test(`${id} utility uses native navigation while preserving the remembered game`, async ({ page }) => {
    const state = await pickerFixture(page, identity({ is_admin: true, can_view_analytics: true }));
    const destination = id === "admin" ? "/admin" : "/admin/dashboard";
    // A labelled destination keeps this test about native link behavior. The
    // real Admin Center journey and real dashboard route guards run separately.
    await page.route(`**${destination}`, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Labelled utility destination</title><h1>Utility destination</h1>" }));
    const menu = await openPicker(page);
    const entry = menu.locator(`a[data-suite-utility-entry="${id}"]`);
    await Promise.all([page.waitForURL(url => url.pathname === destination), entry.click()]);
    const url = new URL(page.url());
    expect(url.searchParams.has("game_switch_from")).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("zdwa_app_mode"))).toBe("hausdepp");
    expect(state.adminMutations).toEqual([]);
  });
}
