const { test, expect } = require("@playwright/test");

// The Hausdepp sign-in document registers its product worker. Worker-owned
// fetches bypass page.route and would reach the real /me endpoint instead of
// the explicit discovery-failure response exercised below.
test.use({ serviceWorkers: "block" });

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1366, height: 900 },
];
const products = [
  { game: "zdwa", name: "ZDWA", paths: ["/", "/regeln", "/konto"], table: ".room-header", ready: ".player-card.me" },
  { game: "zilch", name: "Zilch", paths: ["/zilch", "/zilch/regeln", "/zilch/konto"], table: ".zilch-header", ready: ".zilch-shell--game" },
  { game: "hausdepp", name: "Hausdepp", paths: ["/hausdepp", "/hausdepp/regeln", "/hausdepp/konto"], table: "#hausdeppHeader", ready: "#hausdeppWaiting" },
  { game: "watten", name: "Watten", paths: ["/watten", "/watten/regeln", "/watten/konto/einstellungen"], table: ".wt-header", ready: ".wt-waiting" },
];

async function signedInContext(browser, baseURL, game, language) {
  const context = await browser.newContext({
    baseURL, viewport: viewports[0], serviceWorkers: "block", reducedMotion: "reduce",
  });
  await context.addInitScript(value => {
    localStorage.setItem("zdwa_language", value);
    localStorage.setItem("wuerfler_theme", "light");
    localStorage.setItem("zilch_theme", "light");
    localStorage.setItem("rollthedice.tours.v1.guest", JSON.stringify({
      enabled: true, games: { zdwa: "dismissed", zilch: "dismissed", hausdepp: "dismissed" },
    }));
  }, language);
  const login = await context.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(login.ok()).toBeTruthy();
  let user = (await login.json()).user;
  if (game === "zilch") {
    const created = await context.request.post("/api/admin/users", {
      headers: { "X-CSRF-Token": user.csrf_token },
      data: { username: "Mani", temporary_password: "mani-preview-password-123", role: "admin" },
    });
    expect([201, 400]).toContain(created.status());
    const preview = await context.request.post("/api/auth/login", {
      data: { username: "Mani", password: "mani-preview-password-123" },
    });
    expect(preview.ok()).toBeTruthy();
    user = (await preview.json()).user;
  }
  // Keep each language local to this browser. The actual identity and game
  // capabilities still come from the server, including Watten's owner preview.
  await context.route("**/api/auth/me", async route => {
    const response = await route.fetch();
    const auth = await response.json();
    await route.fulfill({ response, json: {
      ...auth,
      user: { ...auth.user, must_change_password: false,
        preferences: { ...auth.user.preferences, preferred_language: language } },
    } });
  });
  await context.route("**/api/auth/tours/offer", route => route.fulfill({ json: {
    show: false, enabled: true, games: { zdwa: "dismissed", zilch: "dismissed", hausdepp: "dismissed" },
  } }));
  await context.route("**/api/releases**", route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  return { context, user };
}

async function headerGeometry(page) {
  return page.locator(".suite-header:not(.suite-header--table)").evaluate(header => {
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
    const control = element => {
      const box = rect(element);
      return { ...box, text: element.textContent.trim(),
        reachable: element.contains(document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)),
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    };
    return {
      header: rect(header), brand: rect(header.querySelector(".suite-header__brand")),
      brandNameVisible: (() => {
        const name = header.querySelector(".suite-header__brand > span:last-child");
        return Boolean(name && visible(name) && name.getBoundingClientRect().width > 1);
      })(),
      tools: rect(header.querySelector(".suite-header__tools")),
      links: [...header.querySelectorAll(".suite-header__nav a")].filter(visible).map(control),
      controls: [...header.querySelectorAll(".suite-header__tools select, .suite-header__tools button")].filter(visible).map(control),
      language: rect(header.querySelector("[data-language-switcher]")),
      theme: header.querySelector("[data-theme-toggle]") ? rect(header.querySelector("[data-theme-toggle]")) : null,
      picker: rect(header.querySelector("[data-game-switch]")),
      viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      position: getComputedStyle(header).position,
    };
  });
}

async function expectTwoRows(page, path) {
  const geometry = await headerGeometry(page);
  expect(geometry.position, `${path}: sticky header`).toBe("sticky");
  expect(geometry.brandNameVisible, `${path}: game name remains visible beside its icon`).toBe(true);
  expect(geometry.links, `${path}: four navigation destinations`).toHaveLength(4);
  expect(geometry.documentWidth, `${path}: document fits viewport`).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.brand.right, `${path}: brand clear of tools`).toBeLessThanOrEqual(geometry.tools.left + 1);
  expect(Math.abs((geometry.brand.top + geometry.brand.bottom - geometry.tools.top - geometry.tools.bottom) / 2), `${path}: branding and tools share first row`).toBeLessThanOrEqual(2);
  expect(geometry.language.right, `${path}: language precedes picker`).toBeLessThanOrEqual(geometry.picker.left + 1);
  if (geometry.theme?.width) {
    expect(geometry.language.right, `${path}: language precedes design`).toBeLessThanOrEqual(geometry.theme.left + 1);
    expect(geometry.theme.right, `${path}: design precedes picker`).toBeLessThanOrEqual(geometry.picker.left + 1);
  }
  const first = geometry.links[0];
  for (const link of geometry.links) {
    expect(link.top, `${path}: navigation below first row`).toBeGreaterThanOrEqual(Math.max(geometry.brand.bottom, geometry.tools.bottom) - 1);
    expect(Math.abs(link.top - first.top), `${path}: navigation shares second row`).toBeLessThanOrEqual(1);
    expect(link.height, `${path}: ${link.text} target height`).toBeGreaterThanOrEqual(44);
    expect(link.width, `${path}: ${link.text} target width`).toBeGreaterThanOrEqual(44);
    expect(link.left, `${path}: ${link.text} left edge`).toBeGreaterThanOrEqual(geometry.header.left - 1);
    expect(link.right, `${path}: ${link.text} right edge`).toBeLessThanOrEqual(geometry.header.right + 1);
    expect(link.scrollWidth, `${path}: ${link.text} is unclipped`).toBeLessThanOrEqual(link.clientWidth + 1);
    expect(link.reachable, `${path}: ${link.text} is clickable`).toBe(true);
  }
  for (const control of geometry.controls) {
    expect(control.left, `${path}: control left edge`).toBeGreaterThanOrEqual(geometry.header.left - 1);
    expect(control.right, `${path}: control right edge`).toBeLessThanOrEqual(geometry.header.right + 1);
    expect(control.height, `${path}: control target height`).toBeGreaterThanOrEqual(44);
    expect(control.reachable, `${path}: control is clickable`).toBe(true);
  }
}

async function expectStickyOnScroll(page) {
  // Short account pages still need the same document-scroll behaviour. A
  // neutral trailing spacer gives the browser room without changing the header.
  await page.evaluate(() => {
    if (document.documentElement.scrollHeight < innerHeight + 600) {
      const spacer = document.createElement("div");
      spacer.style.height = "1000px";
      spacer.dataset.headerScrollFixture = "true";
      document.querySelector(".suite-header").parentElement.append(spacer);
    }
    scrollTo({ top: 450, behavior: "instant" });
  });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200);
  await expect.poll(async () => (await headerGeometry(page)).header.top).toBeGreaterThanOrEqual(-1);
  expect((await headerGeometry(page)).header.top).toBeLessThanOrEqual(2);
  await expectTwoRows(page, "after scrolling");
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
}

test("ZDWA account tabs stay below the sticky header without blocking its controls", async ({ browser, baseURL }) => {
  const { context } = await signedInContext(browser, baseURL, "zdwa", "de");
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/konto");
    await expect(page.locator("#accountName")).toContainText("Admin");
    await expect(page.locator(".account-tabs")).toBeVisible();
    await expect(page.locator(".suite-header [data-game-switch]")).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "1000px";
      document.querySelector("main").append(spacer);
      scrollTo({ top: 450, behavior: "instant" });
    });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(400);
    await expect(async () => {
      const layout = await page.evaluate(() => {
        const header = document.querySelector(".suite-header");
        const tabs = document.querySelector(".account-tabs");
        return {
          headerBottom: header.getBoundingClientRect().bottom,
          tabsTop: tabs.getBoundingClientRect().top,
          controls: ["[data-language-switcher]", "[data-theme-toggle]", "[data-game-switch]"].map(selector => {
            const control = header.querySelector(selector);
            const box = control.getBoundingClientRect();
            return { selector, reachable: control.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) };
          }),
        };
      });
      expect(layout.tabsTop).toBeGreaterThanOrEqual(layout.headerBottom);
      for (const control of layout.controls) expect(control.reachable, `${control.selector} stays reachable after scrolling`).toBe(true);
    }).toPass({ timeout: 3000 });
  } finally {
    await context.unrouteAll({ behavior: "wait" });
    await context.close();
  }
});

test("Watten keyboard skip link appears above the sticky header", async ({ browser, baseURL }) => {
  const { context } = await signedInContext(browser, baseURL, "watten", "de");
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/watten");
    await expect(page.locator(".wt-lobby-grid")).toBeVisible();
    await expect(page.locator(".suite-header")).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.locator(".wt-skip");
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await expect(async () => {
      await expect(skip).toBeFocused();
      const layout = await skip.evaluate(link => {
        const box = link.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom,
          reachable: link.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) };
      });
      expect(layout.top).toBeGreaterThanOrEqual(0);
      expect(layout.bottom).toBeLessThanOrEqual(844);
      expect(layout.reachable, "focused skip link is painted above the header").toBe(true);
    }).toPass({ timeout: 3000 });
    await page.keyboard.press("Enter");
    await expect(page.locator("#wattenApp")).toBeFocused();
  } finally {
    await context.unrouteAll({ behavior: "wait" });
    await context.close();
  }
});

for (const product of products) {
  for (const language of ["de", "en"]) {
    test(`${product.game} ${language}: shared header keeps two rows and sticks on lobby, rules and account pages`, async ({ browser, baseURL }, testInfo) => {
      test.setTimeout(90000);
      const { context } = await signedInContext(browser, baseURL, product.game, language);
      try {
        const page = await context.newPage();
        const labels = language === "de" ? ["Lobby", "Spieler & Ranking", "Regeln", "Konto"] : ["Lobby", "Players & Ranking", "Rules", "Account"];
        for (const path of product.paths) {
          await page.goto(path);
          const header = page.locator(".suite-header:not(.suite-header--table)");
          await expect(header).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute("lang", language);
          await expect(header.locator(".suite-header__nav a")).toHaveText(labels);
          await expect(header.locator("[data-game-switch]")).toBeEnabled();
          await expect(header.locator(".suite-header__brand")).toContainText(product.name);
          await page.evaluate(() => document.fonts.ready);
          for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            await expect(() => expectTwoRows(page, path)).toPass({ timeout: 5000 });
            await expectStickyOnScroll(page);
          }
          if (path === product.paths[0]) {
            await page.setViewportSize(viewports[0]);
            await header.locator("[data-game-switch]").click();
            await expect(page.locator("#suiteGameMenu")).toBeVisible();
            await expect(page.locator(`#suiteGameMenu [data-game-entry="${product.game}"]`)).toHaveAttribute("aria-current", "page");
            await page.keyboard.press("Escape");
            await expect(header.locator("[data-game-switch]")).toBeFocused();
            await page.screenshot({ path: testInfo.outputPath(`${product.game}-${language}-320-header.png`) });
          }
        }
      } finally {
        await context.unrouteAll({ behavior: "wait" });
        await context.close();
      }
    });
  }
}

for (const product of products) {
  test(`${product.game}: entering a real table excludes the shared sticky header and returning restores it`, async ({ browser, baseURL }) => {
    const { context, user } = await signedInContext(browser, baseURL, product.game, "de");
    try {
      const page = await context.newPage();
      await page.goto(product.paths[0]);
      await expect(page.locator(".suite-header:not(.suite-header--table)")).toBeVisible();
      const data = { name: "Header navigation test", mode: product.game === "zdwa" ? 1 : "2", game_type: product.game };
      if (product.game === "zilch") data.play_mode = "multiplayer";
      if (product.game === "hausdepp") Object.assign(data, { play_mode: "multiplayer", cpu_count: 0 });
      if (product.game === "watten") data.watten_recipe = {
        kind: "watten_recipe", schema_version: 1, ruleset_id: "watten-house", ruleset_version: 1,
        player_count: 2, determination: "normal", blind: false, critical: false, target_points: 11,
        cpu_seats: [], show_rechter: false, trick_history: false, partner_hand: false, password_required: false,
      };
      const created = await context.request.post("/api/games", { headers: { "X-CSRF-Token": user.csrf_token }, data });
      expect(created.ok()).toBeTruthy();
      const id = (await created.json()).game_id;
      const prefix = product.game === "zdwa" ? "" : `/${product.game}`;
      await page.goto(`${prefix}/spiel/${id}?name=${encodeURIComponent(user.username)}`);
      await expect(page.locator(product.ready)).toBeVisible();
      await expect(page.locator(".suite-header:not(.suite-header--table)")).toHaveCount(0);
      expect(await page.locator(product.table).evaluate(element => getComputedStyle(element).position)).not.toBe("sticky");
      await page.goto(product.paths[1]);
      await expect(page.locator(".suite-header:not(.suite-header--table)")).toBeVisible();
      await expectTwoRows(page, "return from table");
    } finally {
      await context.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  });
}

for (const game of ["zilch", "hausdepp"]) {
  for (const language of ["de", "en"]) {
    test(`${game} ${language}: guest sign-in keeps the suite header and remains usable when discovery fails`, async ({ page }) => {
      const state = { unavailable: false };
      const identityStatuses = [];
      page.on("response", response => {
        if (new URL(response.url()).pathname === "/api/auth/me") identityStatuses.push(response.status());
      });
      await page.addInitScript(value => localStorage.setItem("zdwa_language", value), language);
      await page.route("**/api/auth/me", route => state.unavailable
        ? route.fulfill({ status: 503, json: { detail: "unavailable" } })
        : route.fulfill({ json: {
          authenticated: false, user: null,
          game_access: { zilch_public: true, hausdepp_public: true, watten_preview: false },
          registration: { enabled: true, turnstile_enabled: false, email_enabled: false },
          passkeys: { enabled: false },
        } }));
      const path = `/${game}/anmelden`;
      await page.goto(path);
      const header = page.locator(".suite-header:not(.suite-header--table)");
      const picker = header.locator("[data-game-switch]");
      await expect(header).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(picker).toBeEnabled();
      const labels = language === "de" ? ["Lobby", "Spieler & Ranking", "Regeln", "Konto"] : ["Lobby", "Players & Ranking", "Rules", "Account"];
      await expect(header.locator(".suite-header__nav a")).toHaveText(labels);
      await expect(header.locator('[aria-current="page"]')).toHaveText(labels[3]);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await expect(() => expectTwoRows(page, path)).toPass({ timeout: 5000 });
        await expectStickyOnScroll(page);
      }
      await picker.click();
      await expect(page.locator("#suiteGameMenu [data-game-entry]")).toHaveCount(3);
      await page.keyboard.press("Escape");
      state.unavailable = true;
      // Returning focus can already have started an identity read. Finish
      // that shared read, then require a fresh failed discovery refresh.
      await expect.poll(() => page.evaluate(() => window.ZDWA_APP_MODE.refresh())).toBe(false);
      expect(identityStatuses).toContain(503);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator("#zilchPasswordLogin")).toBeVisible();
      await picker.click();
      await expect(page.locator("#suiteGameMenu [data-game-entry]")).toHaveCount(1);
      await expect(page.locator('#suiteGameMenu [data-game-entry="zdwa"]')).toBeVisible();
      await page.keyboard.press("Escape");
      // The first discovery request may fail too. The login form still owns
      // the page and its explicitly requested destination after a reload.
      await page.reload();
      await expect(header).toBeVisible();
      await expect(picker).toBeEnabled();
      await expect(page.locator("#zilchLoginMessage")).toContainText(language === "de"
        ? "Der Anmeldestatus konnte nicht geladen werden" : "Your sign-in status could not be loaded");
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await page.locator("#zilchPasswordLogin").evaluate(details => { details.open = true; });
      await expect(page.locator("#zilchLoginUsername")).toBeVisible();
      await page.unrouteAll({ behavior: "wait" });
    });
  }
}
