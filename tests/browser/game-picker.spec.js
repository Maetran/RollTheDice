const { test, expect } = require("@playwright/test");
const { mkdir, readFile } = require("node:fs/promises");
const path = require("node:path");

test.use({ serviceWorkers: "block" });

const chooserLabel = language => language === "de" ? /Spiel (?:aus)?wählen/ : /Choose (?:a )?game/;

async function languageFixture(page, language) {
  await page.addInitScript(value => localStorage.setItem("zdwa_language", value), language);
}

async function publicAccessFixture(page, language) {
  // The isolated server deliberately has a private Zilch audience. Exercise
  // the shipped chooser with the public auth projection, without opening
  // that server's private APIs or granting a test account new capabilities.
  await languageFixture(page, language);
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    authenticated: false, user: null,
    game_access: { zilch_public: true, zilch_preview: false, hausdepp_public: true, hausdepp_preview: false },
  } }));
}

async function publicZilchDocumentFixture(page) {
  const template = await readFile(path.join(__dirname, "../../app/static/zilch-lobby.html"), "utf8");
  const body = template.includes('data-zilch-public-lobby="true"') ? template
    : template.replace("data-zilch-root", 'data-zilch-root data-zilch-public-lobby="true"');
  await page.route("**/zilch", route => route.fulfill({ contentType: "text/html", body }));
  await page.route("**/api/games?**", route => route.fulfill({ json: { games: [] } }));
  await page.route("**/api/zilch/leaderboards?**", route => route.fulfill({ json: { entries: [] } }));
}

async function ownerFixture(page, language = "de", publicZilch = true) {
  const response = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(response.ok()).toBeTruthy();
  const user = (await response.json()).user;
  await languageFixture(page, language);
  const state = { publicZilch };
  await page.route("**/api/auth/me", async route => {
    const response = await route.fetch();
    const auth = await response.json();
    await route.fulfill({ response, json: {
      ...auth,
      // This labelled projection combines the real founder identity with
      // the independently supported public Zilch rollout for a three-game UI.
      game_access: { ...auth.game_access, zilch_public: state.publicZilch, watten_preview: false },
      user: { ...auth.user, must_change_password: false,
        game_access: { ...auth.user.game_access, watten_preview: false },
        preferences: { ...auth.user.preferences, preferred_language: language } },
    } });
  });
  return { user, state };
}

async function openChooser(page) {
  const trigger = page.locator("[data-game-switch]");
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveAttribute("aria-controls", "suiteGameMenu");
  await trigger.click();
  const menu = page.locator("#suiteGameMenu");
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // Bounds and hit targets describe the resting chooser. Await the actual
  // finite entrance animation rather than sampling its off-screen start.
  await menu.evaluate(node => Promise.all(node.getAnimations({ subtree: true })
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))));
  return { trigger, menu };
}

async function expectCurrentGame(page, name) {
  const trigger = page.locator("[data-game-switch]");
  await expect(trigger).toContainText(name);
  await expect(trigger.locator("svg.game-switch-icon")).toBeVisible();
  const label = trigger.locator("span").filter({ hasText: new RegExp(`^${name}$`) }).first();
  await expect(label).toBeVisible();
  expect(await label.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(1);
  await expect(page.locator("#suiteGameMenu").getByRole("link", { name, exact: true }))
    .toHaveAttribute("aria-current", "page");
}

async function expectHeaderGeometry(page) {
  const problems = await page.evaluate(() => {
    const failures = [];
    const visible = node => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== "hidden";
    };
    const label = node => node.getAttribute("aria-label") || node.textContent.trim() || node.tagName;
    const trigger = document.querySelector("[data-game-picker]");
    const bounds = trigger.getBoundingClientRect();
    for (const child of trigger.children) {
      const box = child.getBoundingClientRect();
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1
          || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) {
        failures.push(`Picker content outside its button: ${label(child)}`);
      }
    }
    const controls = [...document.querySelectorAll(
      ".app-nav-tools :is(button, select), .zilch-header-tools :is(button, select), .app-nav-links a, .zilch-nav-list a",
    )].filter(visible);
    for (let index = 0; index < controls.length; index += 1) {
      const first = controls[index].getBoundingClientRect();
      for (const other of controls.slice(index + 1)) {
        const second = other.getBoundingClientRect();
        const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        if (width > 1 && height > 1) failures.push(`Header controls overlap: ${label(controls[index])} / ${label(other)}`);
      }
    }
    return failures;
  });
  expect(problems).toEqual([]);
}

for (const language of ["de", "en"]) {
  for (const game of ["zdwa", "zilch"]) {
    test(`${language}: public ${game} chooser names all three public games`, async ({ page }) => {
      await publicAccessFixture(page, language);
      if (game === "zilch") await publicZilchDocumentFixture(page);
      await page.goto(game === "zilch" ? "/zilch" : "/regeln");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      const url = page.url();
      const { trigger, menu } = await openChooser(page);
      await expect(trigger).toHaveAccessibleName(chooserLabel(language));
      await expect(menu).toHaveAccessibleName(chooserLabel(language));
      expect(page.url()).toBe(url);
      await expect(menu.getByRole("link")).toHaveCount(3);
      await expect(menu.getByRole("link", { name: "ZDWA", exact: true })).toHaveAttribute("href", "/");
      await expect(menu.getByRole("link", { name: "Zilch", exact: true })).toHaveAttribute("href", "/zilch");
      await expect(menu.getByRole("link", { name: "Hausdepp", exact: true })).toHaveAttribute("href", "/hausdepp");
      await expectCurrentGame(page, game === "zilch" ? "Zilch" : "ZDWA");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }

  test(`${language}: founder sees three named choices and the active Hausdepp identity`, async ({ page }) => {
    await ownerFixture(page, language);
    await page.goto("/hausdepp/konto");
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    const { menu } = await openChooser(page);
    await expect(menu.getByRole("link")).toHaveCount(3);
    for (const name of ["ZDWA", "Zilch", "Hausdepp"]) {
      const link = menu.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link.locator("svg").first()).toBeVisible();
    }
    await expect(menu.getByRole("link", { name: "Hausdepp", exact: true })).toHaveAttribute("href", "/hausdepp");
    await expect(menu.getByRole("link", { name: "Hausdepp", exact: true })).toBeFocused();
    await expectCurrentGame(page, "Hausdepp");
    await menu.locator("[data-game-picker-close]").click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator("[data-game-switch]")).toBeFocused();
  });
}

test("chooser shortcut opens without navigating, respects typing, and cleans up repeated dismissal", async ({ page }) => {
  await ownerFixture(page);
  await page.goto("/regeln");
  const trigger = page.locator("[data-game-switch]");
  await expect(trigger).toBeVisible();
  const url = page.url();
  await trigger.focus();
  await page.keyboard.press("Alt+Shift+Z");
  const menu = page.locator("#suiteGameMenu");
  await expect(menu).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(menu.getByRole("link", { name: "ZDWA", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("link", { name: "Zilch", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("link", { name: "Hausdepp", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(menu.getByRole("link", { name: "ZDWA", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await trigger.click();
    await expect(menu).toHaveCount(1);
    await trigger.click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }

  // The shortcut must not steal focus from either native or rich-text input.
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "picker-typing-fixture";
    input.setAttribute("aria-label", "Labelled shortcut typing fixture");
    const editor = document.createElement("div");
    editor.id = "picker-editor-fixture";
    editor.contentEditable = "true";
    editor.textContent = "Labelled rich-text shortcut fixture";
    document.body.append(input, editor);
  });
  for (const selector of ["#picker-typing-fixture", "#picker-editor-fixture"]) {
    await page.locator(selector).focus();
    await page.keyboard.press("Alt+Shift+Z");
    await expect(menu).toHaveCount(0);
    await expect(page.locator(selector)).toBeFocused();
  }
  expect(page.url()).toBe(url);
});

test("permission revocation removes private Hausdepp choices immediately from an open picker", async ({ page }) => {
  const { user } = await ownerFixture(page);
  await page.goto("/regeln");
  let { menu } = await openChooser(page);
  await expect(menu.getByRole("link", { name: "Hausdepp", exact: true })).toBeVisible();
  await page.evaluate(user => window.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: {
    authenticated: true, user,
    game_access: { zilch_public: true, zilch_preview: false, hausdepp_preview: false },
  } })), user);
  await expect(page.locator('#suiteGameMenu [href*="hausdepp"]')).toHaveCount(0);
  if (!await menu.count()) ({ menu } = await openChooser(page));
  await expect(menu.getByRole("link")).toHaveCount(2);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("zdwa:auth-state", { detail: {
    authenticated: false, user: null,
    game_access: { zilch_public: false, zilch_preview: false, hausdepp_preview: false },
  } })));
  await expect(menu).toHaveCount(0);
  await expect(page.locator("[data-game-switch]")).toBeHidden();
  await expect(page.locator("[data-game-switch]")).toHaveAttribute("aria-expanded", "false");
});

test("phone and desktop pickers stay in the viewport and keep their appropriate keyboard boundaries", async ({ page }) => {
  await ownerFixture(page);
  await page.goto("/hausdepp/regeln");
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const { trigger, menu } = await openChooser(page);
    await expectCurrentGame(page, "Hausdepp");
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(menu.getByRole("link")).toHaveCount(3);
    for (const link of await menu.getByRole("link").all()) {
      const row = await link.boundingBox();
      expect(row.height).toBeGreaterThanOrEqual(44);
      expect(await link.evaluate(node => {
        const box = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
    }
    await menu.getByRole("link", { name: "Hausdepp", exact: true }).focus();
    await page.keyboard.press("Tab");
    if (viewport.width <= 600) {
      await expect(menu).toBeVisible();
      expect(await menu.evaluate(node => node.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    } else await expect(menu).toHaveCount(0);
    await trigger.click();
    await expect(menu).toBeVisible();
    if (viewport.width <= 600) await page.locator("[data-game-picker-backdrop]").click({ position: { x: 8, y: 8 } });
    else await page.locator("h1").click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
});

for (const game of ["zdwa", "zilch"]) {
  test(`public ${game} picker stays inside phone and desktop viewports`, async ({ page }) => {
    await publicAccessFixture(page, "de");
    if (game === "zilch") await publicZilchDocumentFixture(page);
    await page.goto(game === "zilch" ? "/zilch" : "/");
    await expect(page.locator("[data-game-picker]")).toBeVisible();
    for (const viewport of [
      { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 },
      { width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expectHeaderGeometry(page);
      const { menu } = await openChooser(page);
      const bounds = await menu.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect(menu).toHaveCSS("position", "fixed");
      await page.keyboard.press("Escape");
    }
  });
}

for (const game of ["zdwa", "zilch", "hausdepp"]) {
  test(`capture shared ${game} picker across device sizes`, async ({ page }) => {
    test.skip(process.env.SUITE_PICKER_CAPTURE !== "1", "One explicit evidence batch after interactions pass.");
    if (game === "hausdepp") await ownerFixture(page);
    else {
      await publicAccessFixture(page, "de");
      if (game === "zilch") await publicZilchDocumentFixture(page);
    }
    await mkdir(".impeccable/review", { recursive: true });
    await page.goto(game === "hausdepp" ? "/hausdepp/konto" : game === "zilch" ? "/zilch" : "/");
    const sizes = [
      ["phone-portrait", 390, 844], ["phone-landscape", 844, 390], ["narrow-phone", 320, 568],
      ["tablet-portrait", 768, 1024], ["tablet-landscape", 1024, 768],
      ["desktop-portrait", 900, 1440], ["desktop-landscape", 1440, 900],
    ];
    for (const [size, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${game} ${size} header overflow`).toBe(true);
      await expect(page.locator("[data-game-picker]")).toBeVisible();
      await expectHeaderGeometry(page);
      const { menu } = await openChooser(page);
      const bounds = await menu.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
      await page.screenshot({ path: `.impeccable/review/suite-picker-${game}-${size}.png`, fullPage: false });
      await page.keyboard.press("Escape");
    }
  });
}
