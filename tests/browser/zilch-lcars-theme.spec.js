const { test, expect } = require("@playwright/test");

const LCARS_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 844 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];

async function expectImageFreeCanvas(page) {
  const canvas = await page.evaluate(() => (
    [document.documentElement, document.body].flatMap(element => (
      [null, "::before", "::after"].map(pseudo => ({
        surface: `${element.tagName.toLowerCase()}${pseudo || ""}`,
        backgroundImage: getComputedStyle(element, pseudo).backgroundImage,
      }))
    ))
  ));
  for (const surface of canvas) {
    expect(surface.backgroundImage, surface.surface).toBe("none");
  }
}

async function enableInstalledAppStyles(page) {
  // Chromium's media emulation does not support display-mode. Activate the
  // shipped standalone media rules through CSSOM to exercise their real
  // cascade, including the classic wood layer on body::before.
  const enabled = await page.evaluate(() => {
    let count = 0;
    const visit = rules => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes("display-mode: standalone")) {
          rule.media.mediaText = "all";
          count += 1;
        }
        if (rule.cssRules) visit(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) visit(sheet.cssRules);
    return count;
  });
  expect(enabled).toBeGreaterThan(0);
}

async function expectLcarsViewports(page) {
  for (const viewport of LCARS_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectImageFreeCanvas(page);
    await expect(page.locator("[data-theme-toggle]")).toBeVisible();
    const layout = await page.evaluate(() => {
      const toggle = document.querySelector("[data-theme-toggle]").getBoundingClientRect();
      const player = document.querySelector(".zilch-notebook-player.is-active");
      const dock = document.querySelector(".zilch-dice-dock");
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        toggleLeft: toggle.left,
        toggleRight: toggle.right,
        score: player && dock ? {
          historyHeight: player.querySelector("ol").clientHeight,
          footerBottom: player.querySelector("footer").getBoundingClientRect().bottom,
          dockTop: dock.getBoundingClientRect().top,
        } : null,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.toggleLeft).toBeGreaterThanOrEqual(-1);
    expect(layout.toggleRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
    if (layout.score) {
      expect(layout.score.historyHeight).toBeGreaterThanOrEqual(16);
      expect(layout.score.footerBottom).toBeLessThanOrEqual(layout.score.dockTop);
    }
  }
}

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
  // Browser specs share the disposable test database.  The preview account
  // setup is intentionally idempotent so this spec does not depend on order.
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

test("Zilch retains its independent LCARS appearance through reloads, languages, and narrow viewports", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();

  try {
    // Keep the ZDWA setting deliberately distinct.  The init script only seeds
    // a blank context, so it cannot hide a failed LCARS persistence on reload.
    await page.addInitScript(() => {
      if (!localStorage.getItem("zilch_theme")) localStorage.setItem("zilch_theme", "light");
      if (!localStorage.getItem("wuerfler_theme")) localStorage.setItem("wuerfler_theme", "classic");
    });

    // The switcher is available before authentication too, so a player can
    // choose the optional LCARS surface on the dedicated Zilch login page.
    await page.goto("/zilch/anmelden");
    const loginAppearance = page.locator("[data-theme-toggle]");
    await expect(loginAppearance).toBeVisible();
    await expect(loginAppearance).toHaveAttribute("data-theme-current", "light");
    await loginAppearance.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "lcars");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("zilch_theme"))).toBe("lcars");
    await expectLcarsViewports(page);
    await enableInstalledAppStyles(page);
    await expectLcarsViewports(page);
    await loginAppearance.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body, "::before").backgroundImage)).toContain("url(");
    await page.setViewportSize({ width: 1440, height: 900 });

    await signInAsPreviewMani(page);
    await page.goto("/zilch");

    const html = page.locator("html");
    const appearance = page.locator("[data-theme-toggle]");
    await expect(page.locator("[data-zilch-root]")).toBeVisible();
    await expect(page.locator("#zilchCreateForm")).toBeVisible();
    await expect(html).toHaveAttribute("data-game", "zilch");
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(appearance).toHaveAttribute("data-theme-current", "light");
    await expect(appearance).toHaveAttribute(
      "aria-label",
      "Darstellung wechseln: Klassisch. Nächstes Design: LCARS.",
    );

    await appearance.click();
    await expect(html).toHaveAttribute("data-theme", "lcars");
    await expect(appearance).toHaveAttribute("data-theme-current", "lcars");
    await expect(appearance).toHaveAttribute(
      "aria-label",
      "Darstellung wechseln: LCARS. Nächstes Design: Klassisch.",
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#000000");
    await expect.poll(() => page.evaluate(() => ({
      zilch: localStorage.getItem("zilch_theme"),
      zdwa: localStorage.getItem("wuerfler_theme"),
    }))).toEqual({ zilch: "lcars", zdwa: "classic" });
    await expectImageFreeCanvas(page);
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");

    // The opt-in style survives a document rebuild, while the ZDWA choice is
    // neither read nor overwritten by the Zilch switcher.
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "lcars");
    await expect(appearance).toHaveAttribute("data-theme-current", "lcars");
    await expect(page.locator("#zilchCreateForm")).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      zilch: localStorage.getItem("zilch_theme"),
      zdwa: localStorage.getItem("wuerfler_theme"),
    }))).toEqual({ zilch: "lcars", zdwa: "classic" });

    // Use the actual shared translation API without persisting an account
    // preference to the database that other browser specs intentionally share.
    await page.evaluate(async () => {
      await window.ZDWA_I18N.setLanguage("en", { persist: false, reload: false });
      window.ZDWA_I18N.translateElement(document.body);
    });
    await expect(html).toHaveAttribute("lang", "en");
    await appearance.click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(appearance).toHaveAttribute(
      "aria-label",
      "Change appearance: Classic. Next design: LCARS.",
    );
    await appearance.click();
    await expect(html).toHaveAttribute("data-theme", "lcars");
    await expect(appearance).toHaveAttribute(
      "aria-label",
      "Change appearance: LCARS. Next design: Classic.",
    );

    await expectLcarsViewports(page);
    await enableInstalledAppStyles(page);
    await expectLcarsViewports(page);

    // The active-room header intentionally becomes denser at 320px. Its
    // icon-only appearance switch must remain visible rather than inheriting
    // the rule that hides the labels of the other room controls.
    await page.setViewportSize({ width: 320, height: 844 });
    await Promise.all([
      page.waitForURL(/\/zilch\/spiel\/[^/]+$/),
      page.locator("#zilchCreateForm button[type='submit']").click(),
    ]);
    await expect(page.locator(".zilch-shell--game")).toBeVisible();
    await expect(page.locator("[data-zilch-board-id]").first()).toBeVisible();
    await expect(appearance.locator("[data-theme-icon]")).toBeVisible();
    await expect(appearance.locator("[data-theme-icon]")).toHaveText("✦");
    await expectLcarsViewports(page);
    await enableInstalledAppStyles(page);
    await expectLcarsViewports(page);
  } finally {
    await context.close();
  }
});
