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
    await loginAppearance.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

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
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#050508");
    await expect.poll(() => page.evaluate(() => ({
      zilch: localStorage.getItem("zilch_theme"),
      zdwa: localStorage.getItem("wuerfler_theme"),
    }))).toEqual({ zilch: "lcars", zdwa: "classic" });
    await page.mouse.move(0, 200);
    await expect(appearance).toHaveCSS("background-color", "rgb(139, 215, 235)");

    const lcarsLook = await page.evaluate(() => {
      const button = document.querySelector("[data-theme-toggle]");
      const header = document.querySelector(".zilch-header");
      return {
        void: getComputedStyle(document.documentElement).getPropertyValue("--lcars-void").trim(),
        colorScheme: document.documentElement.style.colorScheme,
        buttonRadius: getComputedStyle(button).borderTopRightRadius,
        displayFont: getComputedStyle(button).fontFamily,
        headerRail: getComputedStyle(header).borderBottomColor,
      };
    });
    expect(lcarsLook.void).toBe("#050508");
    expect(lcarsLook.colorScheme).toBe("dark");
    expect(Number.parseFloat(lcarsLook.buttonRadius)).toBeGreaterThan(0);
    expect(lcarsLook.displayFont).toContain("Impact");
    expect(lcarsLook.headerRail).toBe("rgb(205, 168, 219)");

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

    for (const viewport of [{ width: 320, height: 844 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect(appearance).toBeVisible();
      const mobile = await page.evaluate(() => {
        const toggle = document.querySelector("[data-theme-toggle]").getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          toggleLeft: toggle.left,
          toggleRight: toggle.right,
        };
      });
      expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewportWidth);
      expect(mobile.toggleLeft).toBeGreaterThanOrEqual(-1);
      expect(mobile.toggleRight).toBeLessThanOrEqual(mobile.viewportWidth + 1);
    }

    // The active-room header intentionally becomes denser at 320px. Its
    // icon-only appearance switch must remain visible rather than inheriting
    // the rule that hides the labels of the other room controls.
    await page.setViewportSize({ width: 320, height: 844 });
    await Promise.all([
      page.waitForURL(/\/zilch\/spiel\/[^/]+$/),
      page.locator("#zilchCreateForm button[type='submit']").click(),
    ]);
    await expect(page.locator(".zilch-shell--game")).toBeVisible();
    await expect(appearance.locator("[data-theme-icon]")).toBeVisible();
    await expect(appearance.locator("[data-theme-icon]")).toHaveText("✦");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});
