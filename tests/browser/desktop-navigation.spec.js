const { test, expect } = require("@playwright/test");

const widths = [1024, 1366, 1920];
const products = [
  {
    game: "zdwa", themes: ["light", "dark", "classic"],
    paths: ["/", "/spieler", "/regeln", "/konto", "/spieler/Admin", "/rangabzeichen", "/admin", "/ergebnis/desktop-navigation-missing"],
  },
  {
    game: "zilch", themes: ["light", "lcars"],
    paths: ["/zilch", "/zilch/bestenlisten", "/zilch/regeln", "/zilch/konto", "/zilch/historie", "/zilch/statistiken", "/zilch/erfolge", "/zilch/spieler/Mani"],
  },
];

async function desktopContext(browser, baseURL, game, theme, language) {
  const context = await browser.newContext({
    baseURL, viewport: { width: widths[0], height: 900 },
    hasTouch: false, isMobile: false, serviceWorkers: "block", reducedMotion: "reduce",
  });
  await context.addInitScript(({ game, theme, language }) => {
    localStorage.setItem(game === "zilch" ? "zilch_theme" : "wuerfler_theme", theme);
    localStorage.setItem("zdwa_language", language);
  }, { game, theme, language });
  const signedIn = await context.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(signedIn.ok()).toBe(true);
  if (game === "zilch") {
    const admin = (await signedIn.json()).user;
    const created = await context.request.post("/api/admin/users", {
      headers: { "X-CSRF-Token": admin.csrf_token },
      data: { username: "Mani", temporary_password: "mani-preview-password-123", role: "admin" },
    });
    expect([201, 400]).toContain(created.status());
    const preview = await context.request.post("/api/auth/login", {
      data: { username: "Mani", password: "mani-preview-password-123" },
    });
    expect(preview.ok()).toBe(true);
  }
  // Check established account pages without first-login password prompts.
  await context.route("**/api/auth/me", async route => {
    const response = await route.fetch();
    const auth = await response.json();
    await route.fulfill({ response, json: {
      ...auth,
      user: { ...auth.user, must_change_password: false, preferences: { ...auth.user.preferences, preferred_language: language } },
    } });
  });
  return context;
}

async function headerGeometry(page, game) {
  return page.evaluate(game => {
    const header = document.querySelector(game === "zilch" ? ".zilch-header" : ".app-nav");
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const style = getComputedStyle(header);
    const box = rect(header);
    return {
      header: box,
      contentRight: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      brand: rect(header.querySelector(game === "zilch" ? ".zilch-brand" : ".app-nav-brand")),
      tools: rect(header.querySelector(game === "zilch" ? ".zilch-header-tools" : ".app-nav-tools")),
      links: [...header.querySelectorAll(game === "zilch" ? ".zilch-nav-list a" : ".app-nav-link")].map(link => {
        const box = rect(link);
        return {
          ...box, text: link.textContent,
          reachable: link.contains(document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)),
          scrollWidth: link.scrollWidth, clientWidth: link.clientWidth,
        };
      }),
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  }, game);
}

for (const { game, themes, paths } of products) {
  for (const theme of themes) {
    test(`${game} ${theme}: desktop navigation stays centered across DE/EN pages`, async ({ browser, baseURL }, testInfo) => {
      test.setTimeout(120000);
      for (const language of ["de", "en"]) {
        const context = await desktopContext(browser, baseURL, game, theme, language);
        try {
          const page = await context.newPage();
          for (const path of paths) {
            await page.goto(path);
            const links = page.locator(game === "zilch" ? ".zilch-nav-list a" : ".app-nav-link");
            await expect(links.first()).toBeVisible();
            await expect(page.locator("html")).toHaveAttribute("lang", language);
            await page.evaluate(() => document.fonts.ready);
            for (const width of widths) {
              await page.setViewportSize({ width, height: 900 });
              await expect(async () => {
                const geometry = await headerGeometry(page, game);
                expect(geometry.links.length).toBeGreaterThanOrEqual(4);
                const first = geometry.links[0];
                const last = geometry.links.at(-1);
                expect(Math.abs((first.left + last.right - geometry.header.left - geometry.header.right) / 2), `${path}: navigation center`).toBeLessThanOrEqual(1);
                expect(geometry.documentWidth, path).toBeLessThanOrEqual(geometry.viewportWidth);
                for (const link of geometry.links) {
                  expect(link.reachable, `${path}: ${link.text}`).toBe(true);
                  expect(link.scrollWidth, `${path}: ${link.text}`).toBeLessThanOrEqual(link.clientWidth + 1);
                  expect(link.left, path).toBeGreaterThanOrEqual(geometry.header.left);
                  expect(link.right, path).toBeLessThanOrEqual(geometry.header.right + 1);
                  expect(Math.abs((link.top + link.bottom - first.top - first.bottom) / 2), `${path}: navigation row`).toBeLessThanOrEqual(1);
                }
                // A shared row must leave clear room between links and tools.
                if (first.top < geometry.brand.bottom && first.bottom > geometry.brand.top) {
                  expect(first.left, `${path}: brand does not overlap navigation`).toBeGreaterThanOrEqual(geometry.brand.right - 1);
                  expect(last.right, `${path}: tools do not overlap navigation`).toBeLessThanOrEqual(geometry.tools.left + 1);
                }
              }).toPass({ timeout: 5000 });
              if (path === paths[0] && language === "de" && width === 1366) {
                await page.screenshot({ path: testInfo.outputPath("desktop-header.png") });
              }
            }
          }
        } finally { await context.close(); }
      }
    });
  }
}

for (const theme of ["light", "lcars"]) {
  test(`Zilch ${theme}: unavailable pages keep desktop tools at the right edge`, async ({ browser, baseURL }) => {
    const context = await desktopContext(browser, baseURL, "zilch", theme, "de");
    try {
      const page = await context.newPage();
      for (const kind of ["spiel", "ergebnis"]) {
        const response = await page.goto(`/zilch/${kind}/desktop-navigation-missing`);
        expect(response.status()).toBe(404);
        await expect(page.locator(".zilch-header-tools")).toBeVisible();
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          const geometry = await headerGeometry(page, "zilch");
          expect(geometry.links).toHaveLength(0);
          expect(Math.abs(geometry.tools.right - geometry.contentRight)).toBeLessThanOrEqual(1);
          expect(geometry.tools.left).toBeGreaterThanOrEqual(geometry.brand.right);
        }
      }
    } finally { await context.close(); }
  });
}
